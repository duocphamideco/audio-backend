const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const OUT = path.join(__dirname, 'downloads');
fs.mkdirSync(OUT, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(OUT, {
  setHeaders(res){ res.setHeader('Content-Disposition','attachment'); }
}));

function isYoutubeUrl(raw){
  try{
    const u = new URL(raw);
    return ['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname);
  }catch{return false}
}
function cleanName(s){
  return (s || 'youtube_audio')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,120) || 'youtube_audio';
}
function run(cmd,args){
  return new Promise((resolve,reject)=>{
    const p=spawn(cmd,args,{windowsHide:true});
    let out='',err='';
    p.stdout.on('data',d=>out+=d.toString());
    p.stderr.on('data',d=>err+=d.toString());
    p.on('error',reject);
    p.on('close',code=>code===0?resolve(out):reject(new Error(err||`${cmd} exited ${code}`)));
  });
}

app.post('/api/extract', async (req,res)=>{
  const url = String(req.body?.url || '').trim();
  if(!isYoutubeUrl(url)) return res.status(400).json({error:'Link YouTube không hợp lệ.'});

  const id=crypto.randomBytes(8).toString('hex');
  try{
    // Lấy tiêu đề để đặt tên file.
    let title='youtube_audio';
    try{
      title=(await run('yt-dlp',['--no-playlist','--print','%(title)s',url])).trim().split(/\r?\n/)[0] || title;
    }catch{}

    const safe=cleanName(title);
    const template=path.join(OUT,`${id}.%(ext)s`);

    // yt-dlp dùng ffmpeg để chuyển track audio tốt nhất thành MP3.
    await run('yt-dlp',[
      '--no-playlist',
      '--no-warnings',
      '--extract-audio',
      '--audio-format','mp3',
      '--audio-quality','0',
      '-o',template,
      url
    ]);

    const src=path.join(OUT,`${id}.mp3`);
    if(!fs.existsSync(src)) throw new Error('Không tạo được file MP3.');

    const filename=`${safe}.mp3`;
    const finalPath=path.join(OUT,`${id}_${filename}`);
    fs.renameSync(src,finalPath);

    // Tự xóa file sau 60 phút.
    setTimeout(()=>fs.unlink(finalPath,()=>{}),60*60*1000).unref?.();

    res.json({
      ok:true,
      title,
      filename,
      fileUrl:'/downloads/'+encodeURIComponent(path.basename(finalPath))
    });
  }catch(e){
    console.error(e);
    res.status(500).json({
      error:'Không lấy được audio. Hãy kiểm tra yt-dlp/ffmpeg, quyền truy cập video hoặc thử video khác.'
    });
  }
});

app.get('/health',(req,res)=>res.json({ok:true}));
app.listen(PORT,()=>console.log(`IDECO YouTube Audio: http://localhost:${PORT}`));
