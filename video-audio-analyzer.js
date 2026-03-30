/* ============================================================
   VIDEO AUDIO ANALYZER v3.1 — Probabilistic output
   
   Now returns evidence[] array to integrate with
   the probabilistic system in VideoDetector v3.
   ============================================================ */
'use strict';

window.VideoAudioAnalyzer = (function () {

    const SR = 22050;

    async function analyze(videoFile, brain) {
        const result = { score:50, details:'Not analyzed', signals:[], evidence:[], breakdown:{}, hasAudio:false, isMusicDominated:false };

        if (!window.AudioContext && !window.webkitAudioContext) { result.details='Web Audio API not supported'; return result; }

        let buf;
        try { buf = await extractBuffer(videoFile); }
        catch (err) { result.details=`No audio track (${err.message})`; return result; }
        if (!buf || buf.duration < 0.5) { result.details='Audio track too short'; return result; }
        result.hasAudio = true;

        // Music check
        const musicTest = detectMusic(buf);
        if (musicTest.isMusicDominated) { result.isMusicDominated=true; result.details=`Music detected — ignored (${musicTest.reason})`; return result; }

        // Silence check
        if (silenceRatio(buf) > 0.70) { result.details='Track mostly silent — ignored'; return result; }

        // Analyses
        const ambient   = analyzeAmbient(buf);
        const cuts      = analyzeCuts(buf);
        const freq      = analyzeFreq(buf);
        const energy    = analyzeEnergy(buf);
        const tts       = analyzeTTS(buf);

        result.breakdown = { ambient, cuts, freq, energy, tts };
        const triggered = [ambient, cuts, freq, energy, tts].filter(s=>s.triggered);
        result.signals  = triggered.map(s=>s.name);

        // Build evidence array
        triggered.forEach(s => {
            if (s.direction === 'ai')   result.evidence.push(`audio — ${s.details}`);
            else if (s.direction==='real') result.evidence.push(`audio — ${s.details}`);
        });

        result.score   = computeScore(ambient, cuts, freq, energy, tts);
        result.details = buildDetails(ambient, cuts, freq, energy, tts);

        console.group('[AudioAnalyzer] v3.1');
        console.log('Duration:',buf.duration.toFixed(1),'s · Music:',musicTest.reason);
        [ambient,cuts,freq,energy,tts].forEach(s=>console.log(`${s.name}: ${s.direction} — ${s.details}`));
        console.log('Score:',result.score+'%');
        console.groupEnd();

        return result;
    }

    function extractBuffer(file) {
        return new Promise((resolve,reject)=>{
            const Ctx=window.AudioContext||window.webkitAudioContext, ctx=new Ctx({sampleRate:SR}), rd=new FileReader();
            rd.onload=async e=>{ try{ const b=await ctx.decodeAudioData(e.target.result); await ctx.close(); resolve(b); }catch(err){ await ctx.close(); reject(new Error('Unsupported codec')); } };
            rd.onerror=()=>reject(new Error('FileReader error'));
            rd.readAsArrayBuffer(file);
        });
    }

    function detectMusic(buf) {
        const data=buf.getChannelData(0),sr=buf.sampleRate;
        const lws=Math.floor(sr*0.05),hws=Math.floor(sr*0.005);
        const nw=Math.min(20,Math.floor(data.length/lws)),step=Math.floor(data.length/nw);
        let lZCR=[],hZCR=[],rms=[];
        for(let w=0;w<nw;w++){
            const st=w*step;
            let lc=0; const le=Math.min(st+lws,data.length-1); for(let i=st+1;i<le;i++) if((data[i]>=0)!==(data[i-1]>=0)) lc++;
            lZCR.push(lc/((le-st)/sr));
            let hc=0; const he=Math.min(st+hws,data.length-1); for(let i=st+1;i<he;i++) if((data[i]>=0)!==(data[i-1]>=0)) hc++;
            hZCR.push(hc/((he-st)/sr));
            let s2=0; const re2=Math.min(st+lws,data.length); for(let i=st;i<re2;i++) s2+=data[i]*data[i];
            rms.push(Math.sqrt(s2/(re2-st)));
        }
        const aL=lZCR.reduce((a,b)=>a+b,0)/lZCR.length, aH=hZCR.reduce((a,b)=>a+b,0)/hZCR.length, aR=rms.reduce((a,b)=>a+b,0)/rms.length;
        const cv=aR>0?Math.sqrt(rms.reduce((s,v)=>s+Math.pow(v-aR,2),0)/rms.length)/aR:0;
        if(aL>180&&aH>1800&&cv<0.45&&aR>0.05) return {isMusicDominated:true,reason:`bass=${aL.toFixed(0)} treble=${aH.toFixed(0)} rmsCV=${cv.toFixed(2)}`};
        if(aR>0.25&&cv<0.30) return {isMusicDominated:true,reason:`sustained energy rms=${aR.toFixed(3)} cv=${cv.toFixed(2)}`};
        return {isMusicDominated:false,reason:`bass=${aL.toFixed(0)} treble=${aH.toFixed(0)}`};
    }

    function silenceRatio(buf) {
        const d=buf.getChannelData(0); let sl=0;
        for(let i=0;i<d.length;i+=4) if(Math.abs(d[i])<0.005) sl++;
        return sl/(d.length/4);
    }

    function analyzeAmbient(buf) {
        const data=buf.getChannelData(0),ws=Math.floor(buf.sampleRate*0.1);
        const nw=Math.min(16,Math.floor(data.length/ws)),step=Math.floor(data.length/nw),rms=[];
        for(let w=0;w<nw;w++){ const s=w*step,e=Math.min(s+ws,data.length); let s2=0; for(let i=s;i<e;i++) s2+=data[i]*data[i]; rms.push(Math.sqrt(s2/(e-s))); }
        const m=rms.reduce((a,b)=>a+b,0)/rms.length, cv=m>0?Math.sqrt(rms.reduce((s,v)=>s+Math.pow(v-m,2),0)/rms.length)/m:0;
        let dir='neutral',det=`RMS mean=${m.toFixed(4)} cv=${cv.toFixed(3)}`;
        if(m<0.001){ dir='neutral'; det='Near silent'; }
        else if(cv<0.05){ dir='ai'; det=`Uniformly flat background noise (cv=${cv.toFixed(3)}) — TTS signature`; }
        else if(cv<0.15){ dir='ai'; det=`Low noise variation (cv=${cv.toFixed(3)}) — suspicious`; }
        else if(cv>0.40){ dir='real'; det=`Organic noise variation (cv=${cv.toFixed(3)}) — natural`; }
        else { dir='real'; det=`Normal variation (cv=${cv.toFixed(3)})`; }
        return {name:'ambient',label:'Background noise',triggered:dir!=='neutral',direction:dir,value:cv,details:det};
    }

    function analyzeCuts(buf) {
        const data=buf.getChannelData(0),ws=Math.floor(buf.sampleRate*0.03),rms=[];
        for(let i=0;i+ws<=data.length;i+=ws){ let s2=0; for(let j=i;j<i+ws;j++) s2+=data[j]*data[j]; rms.push(Math.sqrt(s2/ws)); }
        let cuts=0;
        for(let i=1;i<rms.length;i++){ const p=rms[i-1],c=rms[i]; if(p>0.005&&c>0.005&&Math.abs(c-p)/Math.max(p,c)>0.75) cuts++; }
        const cpm=cuts/Math.max(0.1,buf.duration/60);
        let dir='neutral',det=`${cuts} cuts (${cpm.toFixed(1)}/min)`;
        if(cpm>12){ dir='ai'; det+=` — very high, segment-by-segment generation`; }
        else if(cpm>6){ dir='ai'; det+=` — high, suspicious`; }
        else if(cpm<2){ dir='real'; det+=` — smooth natural transitions`; }
        return {name:'cuts',label:'Audio cuts',triggered:dir!=='neutral',direction:dir,value:cpm,details:det};
    }

    function analyzeFreq(buf) {
        const data=buf.getChannelData(0),sc=Math.min(data.length,buf.sampleRate*10);
        let cx=0; for(let i=1;i<sc;i++) if((data[i]>=0)!==(data[i-1]>=0)) cx++;
        const zcr=cx/(sc/buf.sampleRate);
        let dir='neutral',det=`ZCR: ${zcr.toFixed(0)}/s`;
        if(zcr<400){ dir='ai'; det+=` — very low, muffled TTS`; }
        else if(zcr<700){ dir='ai'; det+=` — low, limited high frequency content (TTS?)`; }
        else if(zcr>=800&&zcr<=4000){ dir='real'; det+=` — natural speech range`; }
        return {name:'frequency',label:'Frequencies',triggered:dir!=='neutral',direction:dir,value:zcr,details:det};
    }

    function analyzeEnergy(buf) {
        const data=buf.getChannelData(0),ws=Math.floor(buf.sampleRate*0.5);
        const mw=Math.min(20,Math.floor(data.length/ws)),step=Math.floor(data.length/mw),en=[];
        for(let w=0;w<mw;w++){ const s=w*step,e=Math.min(s+ws,data.length); let s2=0; for(let i=s;i<e;i++) s2+=data[i]*data[i]; en.push(s2/(e-s)); }
        const m=en.reduce((a,b)=>a+b,0)/en.length,range=m>0?(Math.max(...en)-Math.min(...en))/m:0;
        let dir='neutral',det=`Energy range: ${range.toFixed(2)}`;
        if(m<0.0001){ dir='neutral'; det='Insufficient energy'; }
        else if(range<0.3){ dir='ai'; det+=` — flat envelope (TTS?)`; }
        else if(range<0.8){ dir='ai'; det+=` — low dynamics, suspicious`; }
        else if(range>2.5){ dir='real'; det+=` — natural speech dynamics`; }
        else { dir='real'; det+=` — normal dynamics`; }
        return {name:'energy',label:'Energy',triggered:dir!=='neutral',direction:dir,value:range,details:det};
    }

    function analyzeTTS(buf) {
        const data=buf.getChannelData(0),sr=buf.sampleRate,fs=Math.floor(sr*0.02),thr=0.008;
        const segs=[]; let inSil=false,sf=0;
        for(let i=0;i+fs<data.length;i+=fs){
            let s2=0; for(let j=i;j<i+fs;j++) s2+=data[j]*data[j];
            const rms=Math.sqrt(s2/fs);
            if(rms<thr){ if(!inSil){inSil=true;sf=1;}else sf++; }
            else { if(inSil&&sf>=2&&sf<=50) segs.push(sf*20); inSil=false;sf=0; }
        }
        if(segs.length<4) return {name:'tts',label:'TTS Pattern',triggered:false,direction:'neutral',value:0,details:'Not enough pauses to analyze'};
        const m=segs.reduce((a,b)=>a+b,0)/segs.length,cv=m>0?Math.sqrt(segs.reduce((s,v)=>s+Math.pow(v-m,2),0)/segs.length)/m:0;
        let dir='neutral',det=`Pauses CV=${cv.toFixed(3)} (n=${segs.length}, avg=${m.toFixed(0)}ms)`;
        if(cv<0.15){ dir='ai'; det+=` — very regular pauses (TTS confirmed)`; }
        else if(cv<0.30){ dir='ai'; det+=` — fairly regular pauses (suspicious)`; }
        else if(cv>0.55){ dir='real'; det+=` — irregular natural pauses`; }
        else { dir='real'; det+=` — normal pause variation`; }
        return {name:'tts',label:'TTS Pattern',triggered:dir!=='neutral',direction:dir,value:cv,details:det};
    }

    function computeScore(ambient, cuts, freq, energy, tts) {
        const sigs=[{r:ambient,w:3},{r:cuts,w:2},{r:freq,w:2.5},{r:energy,w:2},{r:tts,w:2.5}];
        let ai=0,real=0,tw=0;
        sigs.forEach(({r,w})=>{ if(!r.triggered||r.direction==='neutral') return; if(r.direction==='ai') ai+=w; else real+=w; tw+=w; });
        if(!tw) return 50;
        return Math.min(90,Math.max(12,Math.round(50+(ai-real)/tw*35)));
    }

    function buildDetails(ambient, cuts, freq, energy, tts) {
        const parts=[];
        [ambient,cuts,freq,energy,tts].forEach(s=>{ if(s.triggered&&s.direction!=='neutral') parts.push(`${s.direction==='ai'?'⚠':'✓'} ${s.label}: ${s.details}`); });
        return parts.length>0?parts.join(' · '):'No strong audio signals';
    }

    return { analyze };
})();

console.log('✅ VideoAudioAnalyzer v3.1 ready — evidence[] output for probabilistic integration');