// Runs in a bounded subprocess: malformed documents cannot block the web server.
import { readFile, writeFile } from 'node:fs/promises';
const [file, kind, output] = process.argv.slice(2);
let text = '';
if (kind === 'pdf') {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({
    data: new Uint8Array(await readFile(file)),
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;
  if (pdf.numPages > 40) throw new Error('PDF 最多 40 页，请分批上传。');
  for (let page = 1; page <= pdf.numPages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent();
    const value = content.items.map((item) => item.str || '').join(' ');
    if (value.trim().length < 30)
      throw new Error(
        `第 ${page} 页没有可读取文字。扫描件请先转成 PNG/JPEG 图片上传。`,
      );
    text += `\n[第 ${page} 页]\n${value}`;
    if (text.length > 80000) throw new Error('材料过长，请分批上传。');
  }
  await pdf.destroy();
} else if (kind === 'docx') {
  const mammoth = await import('mammoth');
  text = (await mammoth.default.extractRawText({ path: file })).value;
} else
  text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file));
if (text.length < 20 || text.length > 80000)
  throw new Error('材料需包含 20–80000 字符，请分批上传。');
await writeFile(output, text);
