-- =============================================================
-- SEED — 19 AI Agents Legion (chinh)
-- Codes goc co 20 — chon 19, skip 'security_camera' (gop vao mep_electric)
-- dna_prompt va schemas duoc Agent B fill chi tiet sau
-- =============================================================

INSERT OR IGNORE INTO agents_registry
  (id, code, name, scope, version, dna_prompt, input_schema_json, output_schema_json, tcvn_refs, formulas_json, status)
VALUES
  -- Tang 0: Dieu phoi
  ('agt_cto',
   'cto',
   'CTO Orchestrator',
   'Dieu phoi pipeline 7 phase, phan cong agent, FDIR controller',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   NULL,
   '{}',
   'active'),

  -- Tang 1: Brief & Constraint
  ('agt_brief_analyst',
   'brief_analyst',
   'Brief Analyst Agent',
   'Parse 13 truong brief KH, validate, extract requirements + cung menh + ngu hanh',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   'TCVN 4451:2012',
   '{}',
   'active'),

  -- Tang 2: Concept & Layout
  ('agt_layout_gen',
   'layout_gen',
   'Layout Generator Agent',
   'Sinh layout tham so theo adjacency + Bat Trach + envelope phap ly',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   'TCVN 4513,QCXDVN 01:2021,TCVN 4451:2012',
   '{"corridor_min_mm":900,"window_ratio":"1/8","kitchen_triangle_max_m":6,"stair":"2h+b=620"}',
   'active'),

  ('agt_architect',
   'architect',
   'Architect Agent',
   'Mat dung, mat cat, ban ve kien truc A-04 to A-09',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   'QCXDVN 01:2021,TCVN 4451:2012',
   '{}',
   'active'),

  -- Tang 2: Ket cau
  ('agt_structural',
   'structural',
   'Structural Agent',
   'Cot/dam/san/mong BTCT, schedule thep, S-01 to S-08',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   'TCVN 5574:2018,TCVN 2737:2020,TCVN 9362:2012',
   '{"Rb_M300":17,"Rs_CB400V":350,"mu_min":0.0025,"mu_max":0.04,"Asc":"(Nd*1000-Rb*b*h*0.85)/Rs"}',
   'active'),

  ('agt_load_engineer',
   'load_engineer',
   'Load Engineer Agent',
   'Tinh tai trong: tinh, dong, gio, dat (TCVN 2737:2020)',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   'TCVN 2737:2020,TCVN 9362:2012',
   '{"live_residential_kPa":1.5,"live_office_kPa":4.0,"live_corridor_kPa":3.0}',
   'active'),

  -- Tang 2: MEP (3 nhanh)
  ('agt_mep_electric',
   'mep_electric',
   'MEP Electric Agent',
   'Cap dien, CB, tu dien, an ninh-camera, chong set (gop security_camera)',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   'TCVN 7447,IEC 60364,TCVN 9385:2012',
   '{"safety_factor":1.25,"voltage_drop_max_pct":3}',
   'active'),

  ('agt_mep_plumbing',
   'mep_plumbing',
   'MEP Plumbing Agent',
   'Cap thoat nuoc, Hunter method, DN ong',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   'TCVN 4474,TCVN 4513',
   '{"method":"Hunter","slope_min_pct":2}',
   'active'),

  ('agt_mep_hvac',
   'mep_hvac',
   'MEP HVAC Agent',
   'Dieu hoa, thong gio, BTU calc',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   'QCVN 09:2017',
   '{"BTU":"area_m2*ceiling_h*500*orient_factor","ach_min":10}',
   'active'),

  -- Tang 2: PCCC
  ('agt_fire_safety',
   'fire_safety',
   'Fire Safety Agent',
   'PCCC: loi thoat hiem, cua thoat, vat lieu chong chay',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   'QCVN 06:2022',
   '{"escape_distance_max_m":30,"escape_door_min_mm":1200}',
   'active'),

  -- Tang 3: Noi that & Render
  ('agt_interior_designer',
   'interior_designer',
   'Interior Designer Agent',
   'Bo tri noi that, clearance, mau, vat lieu, FF&E',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   'TCVN 4451:2012',
   '{"bed_clearance_mm":600,"wc_clearance_mm":600,"door_swing_clear":true}',
   'active'),

  ('agt_render_3d',
   'render_3d',
   'Render 3D Agent',
   'Render anh photoreal + GLB, walkthrough',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   NULL,
   '{}',
   'active'),

  -- Tang 3: BOQ + Materials
  ('agt_boq_engine',
   'boq_engine',
   'BOQ Engine Agent',
   'Boc khoi luong tu DXF geometry, KHONG nhap tay',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   NULL,
   '{"price_max_age_days":90}',
   'active'),

  ('agt_material_specialist',
   'material_specialist',
   'Material Specialist Agent',
   'Cap nhat gia vat lieu hang quy, lookup, replacement',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   NULL,
   '{}',
   'active'),

  -- Tang 3: BIM
  ('agt_bim_modeler',
   'bim_modeler',
   'BIM Modeler Agent',
   'Build BIM model tu DXF + structural + MEP, xuat IFC',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   NULL,
   '{}',
   'active'),

  -- Tang 4: Creative
  ('agt_creative_ai',
   'creative_ai',
   'Creative AI Agent',
   'Concept moodboard, style transfer, mau sac, tone',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   NULL,
   '{}',
   'active'),

  -- Tang 4: Phap ly
  ('agt_legal_permit',
   'legal_permit',
   'Legal Permit Agent',
   'Ho so xin phep xay dung, kiem tra phap ly, QCXDVN',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   'QCXDVN 01:2021,QCVN 06:2022,QCVN 09:2017',
   '{}',
   'active'),

  -- Tang 5: QC
  ('agt_qc_inspector',
   'qc_inspector',
   'QC Inspector Agent',
   '12 QC gates, TMR voting, auto-fix loi nho, escalate loi lon',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   'TCVN 5574:2018,TCVN 2737:2020,QCVN 06:2022,QCVN 09:2017,QCXDVN 01:2021,TCVN 4451:2012,TCVN 9385:2012',
   '{}',
   'active'),

  -- Tang 6: Hoc lien tuc
  ('agt_learning',
   'learning_agent',
   'Learning Agent',
   'Hoc tu feedback KTS, cap nhat DNA prompt, tinh chinh formula',
   '1.0.0', 'TBD by Agent B', '{}', '{}',
   NULL,
   '{}',
   'active');

-- HET 19 agents.
