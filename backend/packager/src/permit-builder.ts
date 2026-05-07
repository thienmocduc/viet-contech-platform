// ===============================================================
// Permit Builder — Hồ sơ xin phép xây dựng theo Sở XD
// ===============================================================
// Căn cứ: Nghị định 15/2021/NĐ-CP — Điều 41, 43 + Mẫu 01.
// 8 mục bắt buộc trong hồ sơ:
//   1. Đơn xin cấp GPXD (Mẫu 01 — đính kèm khai sinh trong hồ sơ)
//   2. Bản sao GCN QSDĐ (chủ đầu tư cung cấp — placeholder)
//   3. Bản vẽ thiết kế (mặt bằng + mặt đứng + mặt cắt)
//   4. Phương án PCCC (file F-01)
//   5. Cam kết bảo đảm môi trường
//   6. Báo cáo khảo sát địa chất (placeholder — chủ đầu tư thuê)
//   7. Hợp đồng tư vấn thiết kế
//   8. Bản đồ vị trí khu đất
// ===============================================================

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectInfo, PermitDocument, DeliverableRecord } from './types.js';
import { sanitizeVi } from './file-naming.js';

export interface PermitBuildOptions {
  /** Output folder — sẽ tạo cấu trúc bên trong */
  outDir: string;
  /** Project + chủ đầu tư + thiết kế */
  project: ProjectInfo;
  /** Records từ DB — để lookup F-01 (PCCC), A-02..A-11 (drawings) */
  records: DeliverableRecord[];
}

/** Định nghĩa 8 mục theo Nghị định 15/2021 */
export function buildPermitChecklist(records: DeliverableRecord[]): PermitDocument[] {
  const find = (code: string) => records.find((r) => r.spec.code === code);
  return [
    {
      order: 1, code: 'L-01-1', title: 'Đơn xin cấp Giấy phép xây dựng (Mẫu 01)',
      required: true, is_placeholder: false,
      notes: 'Tự generate từ project data — Mẫu 01 NĐ 15/2021',
    },
    {
      order: 2, code: 'L-01-2', title: 'Bản sao GCN Quyền sử dụng đất',
      required: true, is_placeholder: true,
      notes: 'Chủ đầu tư cung cấp — upload từ trang dự án',
    },
    {
      order: 3, code: 'L-01-3', title: 'Bản vẽ thiết kế kiến trúc',
      required: true, is_placeholder: false,
      source_path: find('A-02')?.abs_path ?? find('A-06')?.abs_path,
      notes: 'Mặt bằng tầng 1 + mặt đứng chính + mặt cắt A-A',
    },
    {
      order: 4, code: 'L-01-4', title: 'Phương án PCCC',
      required: true, is_placeholder: !find('F-01'),
      source_path: find('F-01')?.abs_path,
      notes: 'Mặt bằng PCCC F-01 — kèm thẩm duyệt PCCC nếu nhà ≥7 tầng',
    },
    {
      order: 5, code: 'L-01-5', title: 'Cam kết bảo đảm môi trường + an toàn',
      required: true, is_placeholder: false,
      notes: 'Tự generate template — chủ đầu tư ký',
    },
    {
      order: 6, code: 'L-01-6', title: 'Báo cáo khảo sát địa chất',
      required: true, is_placeholder: true,
      notes: 'Chủ đầu tư thuê đơn vị khảo sát — upload sau',
    },
    {
      order: 7, code: 'L-01-7', title: 'Hợp đồng tư vấn thiết kế',
      required: true, is_placeholder: false,
      notes: 'Tự generate từ designer + owner info',
    },
    {
      order: 8, code: 'L-01-8', title: 'Bản đồ vị trí khu đất',
      required: true, is_placeholder: false,
      notes: 'Trích lục từ A-01 + bản đồ trích đo',
    },
  ];
}

// ----------------------------------------------------------------
// Mẫu 01 — Đơn xin cấp GPXD (text/HTML để render PDF sau)
// ----------------------------------------------------------------

export function renderForm01Text(project: ProjectInfo): string {
  const p = project;
  const o = p.owner;
  const l = p.lot;
  return `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---------------

........., ngày ${new Date().getDate()} tháng ${new Date().getMonth() + 1} năm ${new Date().getFullYear()}

ĐƠN ĐỀ NGHỊ CẤP GIẤY PHÉP XÂY DỰNG
(Sử dụng cho công trình: nhà ở riêng lẻ)
Theo Mẫu số 01, Phụ lục II — Nghị định số 15/2021/NĐ-CP

Kính gửi: Sở Xây dựng / UBND ${l.district}, ${l.city}

1. Tên chủ đầu tư: ${o.full_name}
   - Số CMND/CCCD: ${maskId(o.id_card)}  ${o.id_issued_date ? '— cấp ngày ' + o.id_issued_date : ''}
   - Nơi cấp: ${o.id_issued_place ?? '...'}
   - Địa chỉ thường trú: ${o.permanent_address}
   - Số điện thoại: ${o.phone ?? '...'}
   - Email: ${o.email ?? '...'}

2. Thông tin công trình:
   - Tên công trình: ${p.name}
   - Mã dự án nội bộ: ${p.code}
   - Cấp công trình: Cấp III (nhà ở riêng lẻ)
   - Tổng diện tích sàn: ${p.scale.gfa_m2} m²
   - Số tầng: ${p.scale.floors}
   - Diện tích lô đất: ${p.scale.lot_area_m2} m²

3. Địa điểm xây dựng:
   - Địa chỉ: ${l.address}
   - Phường/Xã: ${l.ward}
   - Quận/Huyện: ${l.district}
   - Tỉnh/Thành phố: ${l.city}
   - Số GCN QSDĐ: ${l.cert_no}${l.cert_date ? ' — cấp ngày ' + l.cert_date : ''}

4. Đơn vị tư vấn thiết kế:
   - Tên đơn vị: ${p.designer.company}
   - Người đại diện: ${p.designer.director_name}
   - Số chứng chỉ hành nghề: ${p.designer.cert_no}
   - Điện thoại: ${p.designer.contact_phone}
   - Email: ${p.designer.contact_email}

5. Cam kết:
   Tôi xin cam kết:
   - Thực hiện đúng theo bản vẽ thiết kế đã được phê duyệt;
   - Bảo đảm an toàn lao động, vệ sinh môi trường, phòng cháy chữa cháy;
   - Chịu trách nhiệm trước pháp luật về nội dung đề nghị này;
   - Bồi thường thiệt hại nếu vi phạm quy định.

CHỦ ĐẦU TƯ
(Ký, ghi rõ họ tên)


${o.full_name}
`;
}

/**
 * Mask CCCD — chỉ hiện 4 chữ cuối khi log/preview.
 * KHÔNG dùng cho file submit thật — bản chính thức cần full số.
 */
function maskId(id: string): string {
  if (!id || id.length < 8) return id;
  return '*'.repeat(id.length - 4) + id.slice(-4);
}

export function renderEnvCommitmentText(project: ProjectInfo): string {
  const p = project;
  return `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---------------

CAM KẾT BẢO ĐẢM MÔI TRƯỜNG VÀ AN TOÀN LAO ĐỘNG

Kính gửi: UBND ${p.lot.district}, ${p.lot.city}

Tôi tên: ${p.owner.full_name}
Là chủ đầu tư công trình: ${p.name}
Địa điểm: ${p.lot.address}, ${p.lot.ward}, ${p.lot.district}, ${p.lot.city}

Tôi xin cam kết trong quá trình thi công xây dựng công trình:
1. Tuân thủ Luật Bảo vệ môi trường 72/2020/QH14 và các văn bản hướng dẫn;
2. Có biện pháp che chắn bụi, giảm tiếng ồn (≤70 dB ban ngày, ≤55 dB ban đêm);
3. Thu gom, vận chuyển, xử lý chất thải xây dựng đúng quy định;
4. Trang bị đầy đủ bảo hộ lao động cho công nhân;
5. Mua bảo hiểm trách nhiệm dân sự bên thứ ba;
6. Chịu mọi chi phí khắc phục sự cố môi trường (nếu xảy ra).

Nếu vi phạm, tôi xin chịu hoàn toàn trách nhiệm trước pháp luật.

........., ngày ${new Date().getDate()} tháng ${new Date().getMonth() + 1} năm ${new Date().getFullYear()}

CHỦ ĐẦU TƯ
(Ký tên)


${p.owner.full_name}
`;
}

export function renderDesignContractText(project: ProjectInfo): string {
  const p = project;
  return `HỢP ĐỒNG TƯ VẤN THIẾT KẾ XÂY DỰNG
Số: VCT-${p.code}-DC-${new Date().getFullYear()}

Hôm nay, ngày ${new Date().getDate()} tháng ${new Date().getMonth() + 1} năm ${new Date().getFullYear()}.

BÊN A (Chủ đầu tư):
- Họ tên: ${p.owner.full_name}
- CMND/CCCD: ${maskId(p.owner.id_card)}
- Địa chỉ: ${p.owner.permanent_address}
- Điện thoại: ${p.owner.phone ?? '...'}

BÊN B (Đơn vị thiết kế):
- Công ty: ${p.designer.company}
- Đại diện: ${p.designer.director_name}
- Chứng chỉ HN: ${p.designer.cert_no}
- Điện thoại: ${p.designer.contact_phone}
- Email: ${p.designer.contact_email}

ĐIỀU 1. ĐỐI TƯỢNG
Bên B nhận tư vấn thiết kế công trình "${p.name}" tại ${p.lot.address},
${p.lot.ward}, ${p.lot.district}, ${p.lot.city}.
Quy mô: ${p.scale.floors} tầng — ${p.scale.gfa_m2} m² sàn.

ĐIỀU 2. PHẠM VI CÔNG VIỆC
- Thiết kế kiến trúc, kết cấu, MEP, nội thất, PCCC;
- Lập hồ sơ xin GPXD;
- Giám sát tác giả trong giai đoạn thi công.

ĐIỀU 3. CAM KẾT
Bên B chịu trách nhiệm về tính chính xác, an toàn, đầy đủ của hồ sơ
thiết kế theo TCVN/QCVN hiện hành.

Hai bên đã đọc và đồng ý ký tên dưới đây.

BÊN A                                   BÊN B
(Chủ đầu tư)                            (${p.designer.company})


${p.owner.full_name}                    ${p.designer.director_name}
`;
}

// ----------------------------------------------------------------
// Build hồ sơ xin phép — output 8 file vào outDir
// ----------------------------------------------------------------

export interface PermitBuildResult {
  out_dir: string;
  documents: PermitDocument[];
  files_written: string[];
  placeholders: string[];
  ready_to_submit: boolean;
}

export async function buildPermitPackage(
  opts: PermitBuildOptions,
): Promise<PermitBuildResult> {
  await mkdir(opts.outDir, { recursive: true });
  const docs = buildPermitChecklist(opts.records);
  const written: string[] = [];
  const placeholders: string[] = [];

  // 1) Đơn Mẫu 01
  const form01Path = join(opts.outDir, '01-Don-xin-cap-GPXD-Mau01.txt');
  await writeFile(form01Path, renderForm01Text(opts.project), 'utf-8');
  written.push(form01Path);

  // 2) Placeholder GCN QSDĐ
  const gcnPath = join(opts.outDir, '02-GCN-QSDD-PLACEHOLDER.txt');
  await writeFile(
    gcnPath,
    `[PLACEHOLDER] Bản sao GCN QSDĐ\nSố GCN: ${opts.project.lot.cert_no}\nChủ đầu tư cần upload bản scan màu file PDF để thay thế file này.`,
    'utf-8',
  );
  written.push(gcnPath);
  placeholders.push(gcnPath);

  // 3) Manifest bản vẽ — không copy lại file (tránh duplicate trong ZIP),
  //    ghi tham chiếu tới folder 01-ARCHITECTURE + 03-MEP/FIRE-SAFETY
  const drawingsRefPath = join(opts.outDir, '03-Banve-thietke-REFS.md');
  await writeFile(
    drawingsRefPath,
    [
      '# Bản vẽ kèm theo hồ sơ xin phép',
      '',
      'Các bản vẽ chi tiết nằm trong các thư mục:',
      '- `../01-ARCHITECTURE/` — A-02 (mặt bằng), A-06 (mặt đứng), A-10/A-11 (mặt cắt)',
      '- `../03-MEP/FIRE-SAFETY/` — F-01 (PCCC)',
      '',
      'Khi nộp Sở XD, in các bản vẽ A-02, A-06, A-10, F-01 ở khổ A1 (tối thiểu).',
    ].join('\n'),
    'utf-8',
  );
  written.push(drawingsRefPath);

  // 5) Cam kết môi trường
  const envPath = join(opts.outDir, '05-Cam-ket-moi-truong.txt');
  await writeFile(envPath, renderEnvCommitmentText(opts.project), 'utf-8');
  written.push(envPath);

  // 6) Placeholder khảo sát địa chất
  const geoPath = join(opts.outDir, '06-Khaosat-diachat-PLACEHOLDER.txt');
  await writeFile(
    geoPath,
    `[PLACEHOLDER] Báo cáo khảo sát địa chất\nChủ đầu tư cần thuê đơn vị khảo sát có chứng chỉ và upload báo cáo để thay file này.`,
    'utf-8',
  );
  written.push(geoPath);
  placeholders.push(geoPath);

  // 7) Hợp đồng thiết kế
  const contractPath = join(opts.outDir, '07-Hop-dong-tu-van-thiet-ke.txt');
  await writeFile(contractPath, renderDesignContractText(opts.project), 'utf-8');
  written.push(contractPath);

  // 8) Bản đồ vị trí — placeholder map data từ A-01
  const mapPath = join(opts.outDir, '08-Bando-vi-tri-khu-dat.md');
  await writeFile(
    mapPath,
    [
      '# Bản đồ vị trí khu đất',
      '',
      `**Địa chỉ:** ${opts.project.lot.address}, ${opts.project.lot.ward}, ${opts.project.lot.district}, ${opts.project.lot.city}`,
      `**Diện tích lô:** ${opts.project.lot.area_m2} m²`,
      `**Số GCN:** ${opts.project.lot.cert_no}`,
      '',
      'Bản đồ trích lục từ A-01 (tổng mặt bằng) + bản đồ địa chính.',
      'Khi in nộp Sở XD: tỷ lệ 1:500 hoặc 1:1000.',
    ].join('\n'),
    'utf-8',
  );
  written.push(mapPath);

  // README
  const readmePath = join(opts.outDir, 'README.md');
  await writeFile(
    readmePath,
    [
      '# Hồ sơ xin phép xây dựng',
      `**${opts.project.name}** — ${opts.project.code} — rev v${opts.project.revision_num}`,
      '',
      'Theo Nghị định 15/2021/NĐ-CP — Điều 41, 43 + Mẫu 01.',
      '',
      '## 8 mục bắt buộc',
      ...docs.map((d) => `${d.order}. **${d.title}** (${d.code})${d.is_placeholder ? ' — *PLACEHOLDER*' : ''}`),
      '',
      '## Lưu ý nộp',
      '- File `*-PLACEHOLDER.txt` cần thay thế bằng bản chính trước khi nộp Sở XD.',
      '- Tất cả bản vẽ in khổ A1 (tối thiểu) — đóng dấu công ty + chữ ký KTS.',
      '- Đơn Mẫu 01 in 3 bản — Sở XD giữ 2, chủ đầu tư giữ 1.',
    ].join('\n'),
    'utf-8',
  );
  written.push(readmePath);

  const ready_to_submit = placeholders.length === 0;

  return {
    out_dir: opts.outDir,
    documents: docs,
    files_written: written,
    placeholders,
    ready_to_submit,
  };
}
