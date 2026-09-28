export async function readAttachment(file: File): Promise<string> {
  if (!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)) throw new Error('Usa JPG, PNG, WebP o PDF.');
  if (file.size > 12 * 1024 * 1024) throw new Error('El archivo supera los 12 MB.');
  const data = await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('No se pudo leer el archivo.'));r.readAsDataURL(file)});
  if(file.type==='application/pdf'){if(file.size>1024*1024)throw new Error('El PDF debe pesar menos de 1 MB.');return data}
  const img=new Image();img.src=data;await img.decode();const ratio=Math.min(1,1200/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*ratio);canvas.height=Math.round(img.height*ratio);const ctx=canvas.getContext('2d');if(!ctx)throw new Error('No se pudo preparar la imagen.');ctx.drawImage(img,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.8);
}
export function downloadFile(name:string,content:Blob){const url=URL.createObjectURL(content);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}
