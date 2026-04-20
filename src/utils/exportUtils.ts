/**
 * exportUtils.ts
 * - Xuất PDF (fix lỗi font tiếng Việt bằng html2canvas → image → jsPDF)
 * - Xuất Word (.docx) bằng docx library
 * - Tối ưu để chạy hoàn toàn client-side
 */

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { saveAs } from 'file-saver';

export interface ExportData {
  title: string;
  canvasDataUrl: string;        // Base64 PNG từ canvas
  solutionHtmlElement: HTMLElement | null;  // DOM element lời giải
  structureInfo: {
    nodeCount: number;
    memberCount: number;
    loadCount: number;
    isStaticDeterminate: boolean;
    doi: number;
  };
  steps: string[];
}

/**
 * YÊU CẦU 2: Xuất PDF – Fix lỗi font tiếng Việt
 * Dùng html2canvas để render HTML → ảnh → chèn vào PDF
 * → Giữ nguyên 100% CSS, font chữ, công thức toán
 */
export async function exportToPDF(data: ExportData): Promise<void> {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 15;
  let currentY = margin;

  // === TRANG 1: TIÊU ĐỀ + SƠ ĐỒ ===
  // Header gradient rectangle (vẽ bằng jsPDF graphics – không cần font)
  pdf.setFillColor(0, 119, 182);
  pdf.rect(0, 0, pageW, 28, 'F');

  pdf.setFillColor(255, 255, 255);
  pdf.setFontSize(16);
  // Dùng encodeURIComponent để tránh lỗi – thay bằng ảnh text
  // Thay vào đó, dùng html2canvas cho header

  // Tạo div tạm để render tiêu đề
  const titleDiv = document.createElement('div');
  titleDiv.style.cssText = `
    position: fixed; top: -9999px; left: 0; z-index: -1;
    width: 794px; padding: 16px 24px;
    background: linear-gradient(135deg, #0077B6, #023E8A);
    font-family: 'Inter', 'Roboto', sans-serif;
    color: white;
  `;
  titleDiv.innerHTML = `
    <div style="font-size:20px; font-weight:700; margin-bottom:4px;">🏗️ ${data.title}</div>
    <div style="font-size:12px; opacity:0.85;">Đề Thi Cơ Học / Kết Cấu | Tạo bởi Ứng Dụng Tĩnh Học</div>
  `;
  document.body.appendChild(titleDiv);

  try {
    // Render tiêu đề
    const titleCanvas = await html2canvas(titleDiv, {
      scale: 2, backgroundColor: null, useCORS: true, logging: false
    });
    const titleImgData = titleCanvas.toDataURL('image/png');
    const titleImgH = (titleCanvas.height / titleCanvas.width) * (pageW - 0);
    pdf.addImage(titleImgData, 'PNG', 0, 0, pageW, titleImgH);
    currentY = titleImgH + 8;
  } finally {
    document.body.removeChild(titleDiv);
  }

  // Thông tin cấu trúc
  const infoDiv = document.createElement('div');
  infoDiv.style.cssText = `
    position: fixed; top: -9999px; left: 0; z-index: -1;
    width: 760px; padding: 12px 16px;
    background: #E0F2FE; border-left: 4px solid #0077B6;
    font-family: 'Inter', 'Roboto', sans-serif; font-size: 13px;
    border-radius: 4px;
  `;
  infoDiv.innerHTML = `
    <div style="display:flex; gap:32px; flex-wrap:wrap;">
      <span>📍 <strong>Số nút:</strong> ${data.structureInfo.nodeCount}</span>
      <span>📏 <strong>Số thanh:</strong> ${data.structureInfo.memberCount}</span>
      <span>⬇️ <strong>Tải trọng:</strong> ${data.structureInfo.loadCount}</span>
      <span>${data.structureInfo.isStaticDeterminate ? '✅' : '⚠️'} <strong>${data.structureInfo.isStaticDeterminate ? 'Tĩnh định' : `Siêu tĩnh bậc ${data.structureInfo.doi}`}</strong></span>
    </div>
  `;
  document.body.appendChild(infoDiv);

  try {
    const infoCanvas = await html2canvas(infoDiv, {
      scale: 2, backgroundColor: null, useCORS: true, logging: false
    });
    const infoImgData = infoCanvas.toDataURL('image/png');
    const infoH = (infoCanvas.height / infoCanvas.width) * (pageW - margin * 2);
    pdf.addImage(infoImgData, 'PNG', margin, currentY, pageW - margin * 2, infoH);
    currentY += infoH + 8;
  } finally {
    document.body.removeChild(infoDiv);
  }

  // Sơ đồ kết cấu từ Canvas
  const sectionLabelDiv = createSectionLabel('📐 Sơ Đồ Kết Cấu');
  document.body.appendChild(sectionLabelDiv);
  try {
    const labelCanvas = await html2canvas(sectionLabelDiv, {
      scale: 2, backgroundColor: null, useCORS: true, logging: false
    });
    const labelImgData = labelCanvas.toDataURL('image/png');
    const labelH = (labelCanvas.height / labelCanvas.width) * (pageW - margin * 2);
    pdf.addImage(labelImgData, 'PNG', margin, currentY, pageW - margin * 2, labelH);
    currentY += labelH + 4;
  } finally {
    document.body.removeChild(sectionLabelDiv);
  }

  // Hình ảnh canvas
  const maxCanvasH = 90;
  const canvasAspect = 800 / 450; // default aspect ratio
  const canvasW = pageW - margin * 2;
  const canvasH = Math.min(maxCanvasH, canvasW / canvasAspect);

  pdf.setDrawColor(180, 210, 240);
  pdf.setLineWidth(0.5);
  pdf.rect(margin, currentY, canvasW, canvasH);
  pdf.addImage(data.canvasDataUrl, 'PNG', margin, currentY, canvasW, canvasH);
  currentY += canvasH + 10;

  // === TRANG LỜI GIẢI ===
  if (data.solutionHtmlElement) {
    pdf.addPage();
    currentY = margin;

    const headerDiv = createSectionLabel('📝 Lời Giải Chi Tiết');
    document.body.appendChild(headerDiv);
    try {
      const hCanvas = await html2canvas(headerDiv, {
        scale: 2, backgroundColor: null, useCORS: true, logging: false
      });
      const hImg = hCanvas.toDataURL('image/png');
      const hH = (hCanvas.height / hCanvas.width) * (pageW - margin * 2);
      pdf.addImage(hImg, 'PNG', margin, currentY, pageW - margin * 2, hH);
      currentY += hH + 6;
    } finally {
      document.body.removeChild(headerDiv);
    }

    // Clone element để tránh ảnh hưởng UI
    const cloned = data.solutionHtmlElement.cloneNode(true) as HTMLElement;
    cloned.style.cssText = `
      position: fixed; top: -9999px; left: 0; z-index: -1;
      width: 760px; background: white; padding: 16px;
      font-family: 'Inter', 'Roboto', sans-serif; font-size: 13px;
      color: #1E293B; line-height: 1.6;
    `;
    document.body.appendChild(cloned);

    try {
      const solCanvas = await html2canvas(cloned, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        allowTaint: true,
        windowWidth: 800,
        windowHeight: cloned.scrollHeight + 40,
        height: cloned.scrollHeight + 40,
      });

      const solImgData = solCanvas.toDataURL('image/png');
      const availW = pageW - margin * 2;
      const imgH = (solCanvas.height / solCanvas.width) * availW;
      const availPageH = pageH - margin * 2;

      // Nếu ảnh dài hơn một trang, chia thành nhiều trang
      if (imgH <= availPageH - currentY) {
        pdf.addImage(solImgData, 'PNG', margin, currentY, availW, imgH);
      } else {
        let srcY = 0;
        let remaining = imgH;
        let firstPage = true;

        while (remaining > 0) {
          const spaceOnPage = firstPage ? (availPageH - currentY) : availPageH;
          const sliceH = Math.min(remaining, spaceOnPage);

          // Tính tỉ lệ để crop ảnh
          const srcYRatio = srcY / imgH;
          const srcHRatio = sliceH / imgH;

          // Dùng canvas tạm để crop
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = solCanvas.width;
          tempCanvas.height = Math.floor(srcHRatio * solCanvas.height);
          const tempCtx = tempCanvas.getContext('2d')!;
          tempCtx.drawImage(
            solCanvas,
            0, Math.floor(srcYRatio * solCanvas.height),
            solCanvas.width, tempCanvas.height,
            0, 0,
            tempCanvas.width, tempCanvas.height
          );

          const sliceImg = tempCanvas.toDataURL('image/png');
          pdf.addImage(sliceImg, 'PNG', margin, firstPage ? currentY : margin, availW, sliceH);

          srcY += sliceH;
          remaining -= sliceH;
          if (remaining > 0) {
            pdf.addPage();
            firstPage = false;
          }
        }
      }
    } finally {
      document.body.removeChild(cloned);
    }
  }

  // Footer
  const totalPages = pdf.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFillColor(240, 248, 255);
    pdf.rect(0, pageH - 10, pageW, 10, 'F');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 120, 150);
    pdf.text(
      `Ứng Dụng Tạo Đề Thi Cơ Học/Kết Cấu | Trang ${i}/${totalPages}`,
      pageW / 2, pageH - 3,
      { align: 'center' }
    );
  }

  pdf.save(`${sanitizeFilename(data.title)}_de_thi.pdf`);
}

/**
 * YÊU CẦU 3: Xuất file Word (.docx)
 * Sử dụng docx library để tạo file Word chuẩn
 * Chèn ảnh canvas dưới dạng Base64
 */
export async function exportToWord(data: ExportData): Promise<void> {
  // Chuyển base64 PNG sang Uint8Array
  const canvasImageBytes = base64ToUint8Array(data.canvasDataUrl);

  // Tạo các paragraph lời giải từ steps array
  const solutionParagraphs: Paragraph[] = [];

  for (const step of data.steps) {
    if (step.startsWith('## ')) {
      solutionParagraphs.push(new Paragraph({
        text: step.replace(/^##\s*/, '').replace(/[📐📝⚙️🔍✅🔎ℹ️⚠️]/gu, ''),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      }));
    } else if (step.startsWith('**') || step.includes('**')) {
      // Bold text
      const text = step.replace(/\*\*(.*?)\*\*/g, '$1').replace(/[✅❌⚠️]/g, '').trim();
      if (text.startsWith('-')) {
        solutionParagraphs.push(new Paragraph({
          children: [new TextRun({ text: text.replace(/^-\s*/, ''), size: 22, font: 'Times New Roman' })],
          bullet: { level: 0 },
          spacing: { after: 60 },
        }));
      } else {
        solutionParagraphs.push(new Paragraph({
          children: [new TextRun({ text, bold: true, size: 22, font: 'Times New Roman' })],
          spacing: { after: 80 },
        }));
      }
    } else if (step.startsWith('- ')) {
      const text = step.replace(/^-\s*/, '').replace(/[✅❌⚠️📍📏⬇️]/gu, '').trim();
      solutionParagraphs.push(new Paragraph({
        children: [new TextRun({ text, size: 22, font: 'Times New Roman' })],
        bullet: { level: 0 },
        spacing: { after: 60 },
      }));
    } else if (step === '---') {
      solutionParagraphs.push(new Paragraph({
        children: [new TextRun({ text: '─'.repeat(60), size: 18, color: '94A3B8' })],
        spacing: { before: 100, after: 100 },
      }));
    } else if (step.trim()) {
      const text = step.replace(/[✅❌⚠️📐📝⚙️🔍🔎ℹ️]/gu, '').trim();
      solutionParagraphs.push(new Paragraph({
        children: [new TextRun({ text, size: 22, font: 'Times New Roman' })],
        spacing: { after: 80 },
      }));
    }
  }

  const doc = new Document({
    creator: 'Ứng Dụng Tạo Đề Thi Cơ Học',
    title: data.title,
    description: 'Đề thi Cơ học / Kết cấu được tạo tự động',
    styles: {
      default: {
        document: {
          run: {
            font: 'Times New Roman',
            size: 24,
          }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1134, right: 850, bottom: 1134, left: 1134 }, // ~2cm margins
          }
        },
        children: [
          // Tiêu đề
          new Paragraph({
            children: [
              new TextRun({
                text: data.title,
                bold: true,
                size: 32,
                color: '023E8A',
                font: 'Times New Roman',
              })
            ],
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: 'De Thi Co Hoc / Ket Cau | Tao boi Ung Dung Tinh Hoc',
                size: 20, color: '475569', italics: true, font: 'Times New Roman',
              })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),

          // Bảng thông tin
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createTableCell('Chi tiet', '023E8A', true),
                  createTableCell('Gia tri', '023E8A', true),
                ]
              }),
              new TableRow({
                children: [
                  createTableCell('So nut (Node)'),
                  createTableCell(String(data.structureInfo.nodeCount)),
                ]
              }),
              new TableRow({
                children: [
                  createTableCell('So thanh (Member)'),
                  createTableCell(String(data.structureInfo.memberCount)),
                ]
              }),
              new TableRow({
                children: [
                  createTableCell('So tai trong (Load)'),
                  createTableCell(String(data.structureInfo.loadCount)),
                ]
              }),
              new TableRow({
                children: [
                  createTableCell('Loai he'),
                  createTableCell(
                    data.structureInfo.isStaticDeterminate
                      ? 'Tinh dinh (r = 3)'
                      : `Sieu tinh bac ${data.structureInfo.doi}`
                  ),
                ]
              }),
            ],
          }),

          new Paragraph({ spacing: { after: 300 } }),

          // Tiêu đề sơ đồ
          new Paragraph({
            children: [new TextRun({ text: 'SO DO KET CAU', bold: true, size: 26, color: '0077B6', font: 'Times New Roman' })],
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 150 },
          }),

          // Hình ảnh canvas
          new Paragraph({
            children: [
              new ImageRun({
                data: canvasImageBytes,
                transformation: {
                  width: 550,
                  height: 320,
                },
                type: 'png',
              } as any)
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),

          // Tiêu đề lời giải
          new Paragraph({
            children: [new TextRun({ text: 'LOI GIAI CHI TIET', bold: true, size: 26, color: '0077B6', font: 'Times New Roman' })],
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 150 },
          }),

          // Các bước lời giải
          ...solutionParagraphs,

          // Footer
          new Paragraph({
            children: [
              new TextRun({
                text: `Tao ngay: ${new Date().toLocaleDateString('vi-VN')} | Ung Dung Tao De Thi Co Hoc/Ket Cau`,
                size: 18, color: '94A3B8', italics: true, font: 'Times New Roman',
              })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 400 },
          }),
        ]
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${sanitizeFilename(data.title)}_de_thi.docx`);
}

// ─── Helper functions ───────────────────────────────────────────────────────

function createSectionLabel(text: string): HTMLDivElement {
  const div = document.createElement('div');
  div.style.cssText = `
    position: fixed; top: -9999px; left: 0; z-index: -1;
    width: 760px; padding: 8px 12px;
    background: #0077B6; color: white;
    font-family: 'Inter', 'Roboto', sans-serif; font-size: 14px; font-weight: 700;
    border-radius: 4px;
  `;
  div.textContent = text;
  return div;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const base64Data = base64.split(',')[1] || base64;
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[àáâãäåæ]/gi, 'a')
    .replace(/[èéêë]/gi, 'e')
    .replace(/[ìíîï]/gi, 'i')
    .replace(/[òóôõö]/gi, 'o')
    .replace(/[ùúûü]/gi, 'u')
    .replace(/[ýÿ]/gi, 'y')
    .replace(/[đ]/gi, 'd')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 60);
}

function createTableCell(text: string, bgColor?: string, isHeader?: boolean): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: isHeader,
            size: 22,
            color: isHeader ? 'FFFFFF' : '1E293B',
            font: 'Times New Roman',
          })
        ],
      })
    ],
    shading: bgColor ? { fill: bgColor } : undefined,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: '93C5FD' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '93C5FD' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '93C5FD' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '93C5FD' },
    },
  });
}
