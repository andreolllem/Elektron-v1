import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

async function main(){
  const svgPath = path.join(process.cwd(), 'assets', 'cleo.svg');
  const outPng = path.join(process.cwd(), 'assets', 'icon.png');

  if (!fs.existsSync(svgPath)){
    console.error('Arquivo SVG não encontrado em assets/cleo.svg');
    process.exit(1);
  }

  const size = 512; // bom para ícone base
  const svg = await fs.promises.readFile(svgPath);

  // Plano de fundo escuro para combinar com o app
  const bg = { r: 11, g: 15, b: 20, alpha: 1 };

  // Renderiza SVG centralizado em 512x512
  const pngBuffer = await sharp(svg, { density: 300 })
    .resize(size, size, { fit: 'contain', background: bg })
    .png({ compressionLevel: 9 })
    .toBuffer();

  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: pngBuffer, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(outPng);

  console.log('Ícone gerado em', outPng);
}

main().catch((err) => { console.error(err); process.exit(1); });

