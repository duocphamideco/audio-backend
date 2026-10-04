const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = process.env.PORT || 10000;
const OUT = path.join(__dirname, 'downloads');
const BIN = path.join(__dirname, 'bin');
const YTDLP = path.join(BIN, 'yt-dlp');

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(BIN, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use('/downloads', express.static(OUT));

function isYoutubeUrl(raw) {
  try {
    const u = new URL(raw);
    return ['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname);
  } catch { return false; }
}

function cleanName(s) {
  return (s || 'youtube_audio')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'youtube_audio';
}

async function ensureYtDlp() {
  if (!fs.existsSync(YTDLP)) {
    console.log('Downloading yt-dlp binary...');
    await YTDlpWrap.downloadFromGithub(YTDLP);
    try { fs.chmodSync(YTDLP, 0o755); } catch {}
    console.log('yt-dlp ready:', YTDLP);
  }
  return new YTDlpWrap(YTDLP);
}

app.get('/', (req,res) => {
  res.type('text').send('IDECO Audio Backend is running. Use /health');
});

app.get('/health', async (req,res) => {
  let ytdlp = false;
  try {
    await ensureYtDlp();
    ytdlp = true;
  } catch (e) {
    console.error('yt-dlp init error:', e);
  }
  res.json({
    ok: true,
    ytdlp,
    ffmpeg: !!ffmpegPath
  });
});

app.post('/api/extract', async (req,res) => {
  const url = String(req.body?.url || '').trim();
  if (!isYoutubeUrl(url)) {
    return res.status(400).json({ error: 'Link YouTube không hợp lệ.' });
  }

  const id = crypto.randomBytes(8).toString('hex');
  const tempTemplate = path.join(OUT, `${id}.%(ext)s`);

  try {
    const yt = await ensureYtDlp();

    let title = 'youtube_audio';
    try {
      const info = await yt.execPromise([
        '--no-playlist',
        '--print', '%(title)s',
        url
      ]);
      title = String(info || '').trim().split(/\r?\n/)[0] || title;
    } catch (e) {
      console.warn('Cannot read title:', e?.message || e);
    }

    console.log('Extracting:', url);

    await yt.execPromise([
      '--no-playlist',
      '--no-warnings',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--ffmpeg-location', ffmpegPath,
      '-o', tempTemplate,
      url
    ]);

    const generated = path.join(OUT, `${id}.mp3`);
    if (!fs.existsSync(generated)) {
      throw new Error('Không tìm thấy file MP3 sau khi chuyển đổi.');
    }

    const filename = `${cleanName(title)}.mp3`;
    const finalName = `${id}_${filename}`;
    const finalPath = path.join(OUT, finalName);
    fs.renameSync(generated, finalPath);

    // Xóa file sau 60 phút
    const timer = setTimeout(() => fs.unlink(finalPath, () => {}), 60 * 60 * 1000);
    if (timer.unref) timer.unref();

    res.json({
      ok: true,
      title,
      filename,
      fileUrl: '/downloads/' + encodeURIComponent(finalName)
    });
  } catch (e) {
    console.error('EXTRACT ERROR:', e);
    res.status(500).json({
      error: 'Không tách được audio.',
      detail: String(e?.message || e)
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`IDECO Audio Backend running on port ${PORT}`);
});
