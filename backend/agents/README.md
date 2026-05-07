# Viet-Contech Agent Registry

DNA system prompt + spec cho 19 AI Agent kỹ thuật vận hành Viet-Contech Design Platform — KTS multi-agent theo nguyên lý NASA / SpaceX (TMR, gate-driven, fail-loud).

## Triết lý

1) **Mỗi agent có 1 phạm vi duy nhất**, KHÔNG kiêm việc lẫn nhau. Agent kết cấu không tự thiết kế nội thất, agent phong thủy không vẽ DWG.
2) **Hard constraints không thương lượng**. Mỗi DNA prompt có mục `TUYỆT ĐỐI KHÔNG` — vi phạm là fail-loud, escalate, không silent-fix.
3) **TMR (Triple Modular Redundancy) cho gate quan trọng**. Mỗi QC gate có 3 voter, majority 2/3 thắng. Đảm bảo robustness khi 1 model lỗi/hallucinate.
4) **Conflict resolution rõ ràng**. Khi 2 agent xung đột, áp thứ tự: an toàn kết cấu > pháp lý > phong thủy > kiến trúc > nội thất > thẩm mỹ.
5) **Output schema ép buộc**. Mỗi agent ràng buộc output JSON đúng schema → caller verify, không cần hiểu plain text agent trả lời.
6) **TCVN/QCVN tham chiếu cụ thể**. Mỗi spec có `tcvn_refs[]`, mỗi formula trích dẫn điều khoản → audit-able.

## Cấu trúc 1 agent spec

```jsonc
{
  "code": "structural",                 // unique slug, dùng làm key trong pipeline
  "name": "Structural Engineer Agent",  // tên hiển thị UI
  "icon": "🏗️",                         // emoji avatar
  "scope": "...",                        // 1-2 câu mô tả phạm vi
  "version": "1.0.0",                    // semver, bump khi sửa DNA prompt
  "phase": ["B4-structural", "B7-qc"],   // pha pipeline agent tham gia
  "tcvn_refs": ["TCVN 5574:2018", ...],  // chuẩn áp dụng
  "input_schema":  { /* JSONSchema */ }, // ép buộc input từ caller
  "output_schema": { /* JSONSchema */ }, // ép buộc output cho downstream
  "dna_prompt":   "ROLE / RESPONSIBILITIES / HARD CONSTRAINTS / OUTPUT CONTRACT",
  "formulas": [ { "name": "...", "expression": "...", "vars": {...} } ],
  "self_test_examples": [ { "input": {...}, "expected_output_keys": [...] } ],
  "timeout_seconds": 360,                // limit để CTO fail-fast
  "tokens_max": 16000,
  "model_hint": "powerful",              // fast | balanced | powerful
  "tmr_voters": ["v1", "v2_alt", "v3_strict"] // 3 prompt variant cho TMR
}
```

## DNA prompt gồm 4 phần

1) **ROLE** — định nghĩa "BẠN LÀ" rõ ràng, không ambiguous
2) **RESPONSIBILITIES** — 3-6 đầu việc cụ thể, đánh số
3) **HARD CONSTRAINTS** — `TUYỆT ĐỐI KHÔNG` + xử lý conflict
4) **OUTPUT CONTRACT** — schema bắt buộc, định dạng file, naming convention

## 19 Agents trong registry

| # | Code | Phase | Mô tả 1 dòng |
|---|------|-------|--------------|
| 01 | `cto` | B0/B1/B12 | Điều phối toàn pipeline, decompose mission, monitor 12 gate |
| 02 | `brief_analyst` | B1/B2 | Đọc brief 13 trường, tính cung mệnh Bát Trạch, pháp lý lô đất |
| 03 | `layout_gen` | B3 | Sinh 30+ layout, MDO scoring 7 trục, chọn top 5 |
| 04 | `architect` | B3 | Mặt bằng A01-A03, mặt đứng 4 hướng, mặt cắt A-A B-B |
| 05 | `structural` | B4/B7 | Cọc/móng/cột/dầm/sàn BTCT TCVN 5574:2018 |
| 06 | `load_engineer` | B4 | Tải DL/LL/Wind/Seismic theo TCVN 2737:2020 |
| 07 | `mep_electric` | B5 | Điện IEC 60364, smart home, Dijkstra routing |
| 08 | `mep_plumbing` | B5 | Cấp/thoát Hunter Method, bơm áp lực, bể nước |
| 09 | `mep_hvac` | B5 | VRV/multi-split, Lossnay, BTU per phòng |
| 10 | `security_camera` | B5 | Greedy Set Cover, FOV 112°, raycast |
| 11 | `fire_safety` | B5/B7 | PCCC QCVN 06:2022, lối thoát ≤30m, sprinkler |
| 12 | `interior_designer` | B6 | 9 phong cách, bố trí phòng, đèn 3 tầng |
| 13 | `render_3d` | B10 | Prompt SD-LoRA, 8 góc/phòng, 360° walkthrough |
| 14 | `boq_engine` | B9 | ezdxf đọc DXF, tra giá DB quý/tỉnh, 3 Excel |
| 15 | `material_specialist` | B6/B9 | DB vật liệu, so sánh ≥3 NCC, alternatives |
| 16 | `bim_modeler` | B8 | IFC 4 export, clash detection, GUID đầy đủ |
| 17 | `legal_permit` | B11 | Hồ sơ xin phép XD, compliance check, fee |
| 18 | `qc_inspector` | B7/B12 | 12 gate TMR voting, auto-fix nhỏ, escalate lớn |
| 19 | `learning_agent` | B0/B12 | Mining pattern lịch sử, đề xuất default |

> Lưu ý: `creative_ai` (sinh 5 concept) đã skip ở phiên bản này — sẽ thêm sau khi pipeline core ổn định và có dữ liệu lịch sử cho Learning Agent training prompt.

## 12 phase pipeline

```
B0-init        → CTO + learning_agent (load defaults)
B1-brief       → brief_analyst
B2-phongthuy   → brief_analyst (Bát Trạch)
B3-layout      → layout_gen → architect
B4-structural  → load_engineer → structural
B5-mep         → parallel(electric, plumbing, hvac, camera, fire)
B6-interior    → interior_designer + material_specialist
B7-qc          → qc_inspector (gate 1-10) + structural sign-off (gate 11)
B8-bim         → bim_modeler (IFC + clash)
B9-boq         → boq_engine
B10-render     → render_3d
B11-legal      → legal_permit
B12-handoff    → qc_inspector (gate 12 KTS sign-off) + cto + learning_agent (capture)
```

## Cách thêm agent mới

1) Tạo entry trong `registry.json` array, đặt `code` unique slug.
2) DNA prompt phải có 4 phần ROLE / RESPONSIBILITIES / HARD CONSTRAINTS / OUTPUT CONTRACT. Tiếng Việt formal.
3) Tham chiếu TCVN/QCVN cụ thể với số hiệu và năm.
4) Ít nhất 1 `TUYỆT ĐỐI KHÔNG` rule + ít nhất 1 conflict-resolution rule.
5) Định nghĩa `input_schema` và `output_schema` bằng JSONSchema chuẩn.
6) Thêm ≥1 `self_test_examples` để CI verify agent.
7) Chạy lại self-test:
   ```bash
   node -e "const r=require('./platform/backend/agents/registry.json'); console.log('Agents:', r.length); r.forEach(a=>console.log(a.code, a.name, a.dna_prompt.length+' chars'))"
   ```
   Đảm bảo mỗi DNA prompt ≥ 200 chars và ≤ 2000 chars.
8) Bump `version` semver:
   - Bug fix prompt → patch (1.0.0 → 1.0.1)
   - Thêm responsibility → minor (1.0.x → 1.1.0)
   - Thay đổi output schema breaking → major (1.x.x → 2.0.0)

## Self-test command

```bash
node -e "const r=require('./platform/backend/agents/registry.json'); \
  console.log('Agents:', r.length); \
  r.forEach(a => console.log(a.code, a.name, a.dna_prompt.length + ' chars'))"
```

Expect: `Agents: 19`, mỗi prompt 200-2000 chars.

## TMR Voter convention

Mỗi agent có 3 voter variant trong `tmr_voters[]`:
- `<code>_v1_default` — prompt mặc định
- `<code>_v2_alt` — prompt sửa wording, cùng logic (catch hallucination)
- `<code>_v3_strict` — prompt thắt chặt rule, ưu tiên reject hơn approve

Khi gọi qua TMR engine: chạy 3 voter song song → so sánh output → majority 2/3 thắng. Nếu 3 khác nhau hoàn toàn → escalate human.

## Liên hệ

CTO + Dev team: cập nhật prompt qua PR vào `registry.json`.
Versioning: mỗi PR sửa DNA bắt buộc bump version + ghi changelog ngắn trong commit message.
