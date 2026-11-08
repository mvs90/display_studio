const {test,expect}=require('@playwright/test');
const fs=require('node:fs');

test('LG JPEG reader handles fragmented frames and releases bounded failed streams',async({page})=>{
  await page.route('http://studio.test/**',route=>route.fulfill({contentType:'text/html',body:'<body></body>'}));
  await page.route('**/camera_preview.js',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync('custom_components/display_studio/www/camera_preview.js')}));
  await page.goto('http://studio.test/');
  const results=await page.evaluate(async()=>{
    const {jpegFrames}=await import('/camera_preview.js'),encoder=new TextEncoder();
    const part=(body)=>`--lg-display-frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${body.length}\r\n\r\n${body}\r\n`;
    const results=[];
    for(const size of [1,7,65536]){
      const data=encoder.encode(part('first')+part('second'));let cancelled=false;
      const response=new Response(new ReadableStream({start(c){for(let i=0;i<data.length;i+=size)c.enqueue(data.slice(i,i+size));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/octet-stream'}});
      const frames=jpegFrames(response),a=await frames.next(),b=await frames.next();await frames.return();
      results.push({frames:[new TextDecoder().decode(a.value),new TextDecoder().decode(b.value)],cancelled,locked:response.body.locked});
    }
    for(const invalid of [
      'x'.repeat(8193),
      '--x\r\nContent-Type: image/jpeg\r\nContent-Length: 6000000\r\n\r\n',
      '--x\r\nContent-Type: image/jpeg\r\nContent-Length: 0\r\n\r\n',
      '--x\r\nContent-Type: text/html\r\nContent-Length: 1\r\n\r\nx',
      '--x\r\nContent-Type: image/jpeg\r\nContent-Length: 5oops\r\n\r\nabcde'
    ]){
      let cancelled=false;
      const response=new Response(new ReadableStream({start(c){c.enqueue(encoder.encode(invalid));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/octet-stream'}});
      let failed=false;try{await jpegFrames(response).next();}catch(_){failed=true;}
      results.push({failed,cancelled,locked:response.body.locked});
    }
    const truncated=new Response(encoder.encode('--x\r\nContent-Type: image/jpeg\r\nContent-Length: 10\r\n\r\nabc'),{headers:{'Content-Type':'application/octet-stream'}});
    let failed=false;try{await jpegFrames(truncated).next();}catch(_){failed=true;}
    results.push({failed,locked:truncated.body.locked});
    return results;
  });
  expect(results.slice(0,3)).toEqual(Array(3).fill({frames:['first','second'],cancelled:true,locked:false}));
  expect(results.slice(3,8)).toEqual(Array(5).fill({failed:true,cancelled:true,locked:false}));
  expect(results[8]).toEqual({failed:true,locked:false});
});
