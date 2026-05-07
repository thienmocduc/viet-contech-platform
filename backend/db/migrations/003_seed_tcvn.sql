-- =============================================================
-- SEED — TCVN/QCVN/QCXDVN rules cot loi (35 rules)
-- Sap xep theo nhom tieu chuan
-- formula_json: {expr,vars,...} — agent dung de validate auto
-- =============================================================

INSERT OR IGNORE INTO tcvn_rules
  (id, code, version, category, statement, formula_json, source_pdf_path, applicable_phases, severity)
VALUES
  -- ===== TCVN 5574:2018 — Ket cau BTCT (8 rules) =====
  ('tr_5574_01','TCVN 5574','2018','structural',
   'Cuong do chiu nen tinh toan be tong M300 (B22.5): Rb = 17 MPa',
   '{"var":"Rb","value":17,"unit":"MPa","grade":"M300"}',
   '/refs/tcvn/5574_2018.pdf','3,4',
   'critical'),

  ('tr_5574_02','TCVN 5574','2018','structural',
   'Cuong do chiu keo cot thep CB400-V: Rs = 350 MPa',
   '{"var":"Rs","value":350,"unit":"MPa","steel":"CB400-V"}',
   '/refs/tcvn/5574_2018.pdf','3,4',
   'critical'),

  ('tr_5574_03','TCVN 5574','2018','structural',
   'Ham luong cot thep doc cot: 0.25% <= mu <= 4.0%',
   '{"expr":"0.0025<=mu<=0.04","var":"mu"}',
   '/refs/tcvn/5574_2018.pdf','3,4',
   'critical'),

  ('tr_5574_04','TCVN 5574','2018','structural',
   'Tiet dien cot toi thieu BTCT: b,h >= 200mm',
   '{"expr":"b>=200&&h>=200","unit":"mm"}',
   '/refs/tcvn/5574_2018.pdf','3,4',
   'high'),

  ('tr_5574_05','TCVN 5574','2018','structural',
   'Lop be tong bao ve cot thep doc cot/dam (trong nha): toi thieu 25mm',
   '{"var":"cover_min","value":25,"unit":"mm","loc":"interior"}',
   '/refs/tcvn/5574_2018.pdf','3,4',
   'high'),

  ('tr_5574_06','TCVN 5574','2018','structural',
   'Lop be tong bao ve mong/san duoi dat: toi thieu 40mm',
   '{"var":"cover_min","value":40,"unit":"mm","loc":"foundation"}',
   '/refs/tcvn/5574_2018.pdf','3,4',
   'high'),

  ('tr_5574_07','TCVN 5574','2018','structural',
   'Nhip dam BTCT toi da kinh te: L <= 8m, vuot 8m phai dam ung luc truoc',
   '{"expr":"L<=8000","unit":"mm"}',
   '/refs/tcvn/5574_2018.pdf','3,4',
   'medium'),

  ('tr_5574_08','TCVN 5574','2018','structural',
   'Do vong dam tham my f <= L/250; gioi han toi da f <= L/200',
   '{"expr":"f<=L/250","limit_max":"L/200"}',
   '/refs/tcvn/5574_2018.pdf','3,4',
   'high'),

  -- ===== TCVN 2737:2020 — Tai trong (5 rules) =====
  ('tr_2737_01','TCVN 2737','2020','load',
   'Hoat tai san nha o/can ho: 1.5 kN/m2',
   '{"var":"qk","value":1.5,"unit":"kN/m2","occupancy":"residential"}',
   '/refs/tcvn/2737_2020.pdf','3',
   'critical'),

  ('tr_2737_02','TCVN 2737','2020','load',
   'Hoat tai san van phong: 4.0 kN/m2',
   '{"var":"qk","value":4.0,"unit":"kN/m2","occupancy":"office"}',
   '/refs/tcvn/2737_2020.pdf','3',
   'critical'),

  ('tr_2737_03','TCVN 2737','2020','load',
   'Hoat tai hanh lang/cau thang nha o: 3.0 kN/m2',
   '{"var":"qk","value":3.0,"unit":"kN/m2","occupancy":"corridor"}',
   '/refs/tcvn/2737_2020.pdf','3',
   'high'),

  ('tr_2737_04','TCVN 2737','2020','load',
   'Tai gio: vung gio II-A (Ha Noi/HCM) ap luc co so W0 = 0.95 kN/m2',
   '{"var":"W0","value":0.95,"unit":"kN/m2","zone":"II-A"}',
   '/refs/tcvn/2737_2020.pdf','3',
   'high'),

  ('tr_2737_05','TCVN 2737','2020','load',
   'Tai dong dat: nha thap tang vung 7 cap PGA = 0.0816g',
   '{"var":"PGA","value":0.0816,"unit":"g","seismic_zone":7}',
   '/refs/tcvn/2737_2020.pdf','3',
   'high'),

  -- ===== TCVN 9362:2012 — Nen mong (2 rules) =====
  ('tr_9362_01','TCVN 9362','2012','foundation',
   'Suc chiu tai nen dat (cap I) cho phep R0 >= 100 kPa',
   '{"var":"R0","min":100,"unit":"kPa"}',
   '/refs/tcvn/9362_2012.pdf','3',
   'critical'),

  ('tr_9362_02','TCVN 9362','2012','foundation',
   'Do lun cho phep nha o thap tang: S <= 80mm',
   '{"var":"S","max":80,"unit":"mm"}',
   '/refs/tcvn/9362_2012.pdf','3',
   'high'),

  -- ===== QCVN 06:2022 — An toan chay (4 rules) =====
  ('tr_qcvn06_01','QCVN 06','2022','fire_safety',
   'Khoang cach loi thoat hiem toi cua thoat: <= 30m (1 huong) hoac 50m (2 huong)',
   '{"var":"d_escape","max":30,"unit":"m","one_way":true}',
   '/refs/qcvn/06_2022.pdf','5,7',
   'critical'),

  ('tr_qcvn06_02','QCVN 06','2022','fire_safety',
   'Do rong loi thoat hiem toi thieu: 1.2m (nha o), 1.4m (cong cong)',
   '{"var":"w_escape","min":1.2,"unit":"m","occupancy":"residential"}',
   '/refs/qcvn/06_2022.pdf','5,7',
   'critical'),

  ('tr_qcvn06_03','QCVN 06','2022','fire_safety',
   'Cua thoat hiem: rong >= 1.2m, mo theo huong thoat, vat lieu chong chay >= EI60',
   '{"door_w_min_m":1.2,"open_dir":"escape","fire_rating":"EI60"}',
   '/refs/qcvn/06_2022.pdf','5,7',
   'critical'),

  ('tr_qcvn06_04','QCVN 06','2022','fire_safety',
   'Khoang cach 2 cua thoat hiem: cach nhau >= 1/2 duong cheo phong',
   '{"expr":"d_doors>=L_diag/2"}',
   '/refs/qcvn/06_2022.pdf','5,7',
   'high'),

  -- ===== QCVN 09:2017 — Hieu qua nang luong (3 rules) =====
  ('tr_qcvn09_01','QCVN 09','2017','energy',
   'EUI nha o <= 120 kWh/m2/year',
   '{"var":"EUI","max":120,"unit":"kWh/m2/year","occupancy":"residential"}',
   '/refs/qcvn/09_2017.pdf','5',
   'high'),

  ('tr_qcvn09_02','QCVN 09','2017','energy',
   'Lop cach nhiet mai: U <= 1.0 W/m2.K (vung khi hau nong)',
   '{"var":"U_roof","max":1.0,"unit":"W/m2K"}',
   '/refs/qcvn/09_2017.pdf','5',
   'medium'),

  ('tr_qcvn09_03','QCVN 09','2017','energy',
   'Cua kinh: SHGC <= 0.5 (huong Tay/Nam)',
   '{"var":"SHGC","max":0.5,"orient":"W,S"}',
   '/refs/qcvn/09_2017.pdf','5',
   'medium'),

  -- ===== QCXDVN 01:2021 — Quy hoach (4 rules) =====
  ('tr_qc01_01','QCXDVN 01','2021','planning',
   'Mat do xay dung lo dat <100m2: <= 80%',
   '{"var":"density","max":0.8,"lot_area_max":100,"unit":"%"}',
   '/refs/qcxdvn/01_2021.pdf','1,2',
   'critical'),

  ('tr_qc01_02','QCXDVN 01','2021','planning',
   'Mat do xay dung lo dat 100-300m2: <= 70%',
   '{"var":"density","max":0.7,"lot_area_min":100,"lot_area_max":300}',
   '/refs/qcxdvn/01_2021.pdf','1,2',
   'critical'),

  ('tr_qc01_03','QCXDVN 01','2021','planning',
   'Lui mat tien (setback) >= 1.5m, lui sau >= 2m',
   '{"setback_front_min_m":1.5,"setback_back_min_m":2}',
   '/refs/qcxdvn/01_2021.pdf','1,2',
   'high'),

  ('tr_qc01_04','QCXDVN 01','2021','planning',
   'Chieu cao toi da nha o lien ke khu trung tam: <= 6 tang (~21m)',
   '{"var":"H_max","value":21,"unit":"m","floors_max":6}',
   '/refs/qcxdvn/01_2021.pdf','1,2',
   'high'),

  -- ===== TCVN 4451:2012 — Nha o (4 rules) =====
  ('tr_4451_01','TCVN 4451','2012','architecture',
   'Chieu cao tran phong o: >= 2.7m (3.0m la khuyen nghi)',
   '{"var":"h_ceiling","min":2.7,"unit":"m","room":"living"}',
   '/refs/tcvn/4451_2012.pdf','2,3',
   'high'),

  ('tr_4451_02','TCVN 4451','2012','architecture',
   'Dien tich cua so >= 1/8 dien tich san phong',
   '{"expr":"window_area>=floor_area/8"}',
   '/refs/tcvn/4451_2012.pdf','2,3',
   'high'),

  ('tr_4451_03','TCVN 4451','2012','architecture',
   'Cau thang: 2h+b = 600..640mm (tieu chuan 620mm)',
   '{"expr":"600<=2*h+b<=640","ideal":620,"unit":"mm"}',
   '/refs/tcvn/4451_2012.pdf','2,3',
   'high'),

  ('tr_4451_04','TCVN 4451','2012','architecture',
   'Dien tich phong ngu chinh >= 12m2, phong ngu phu >= 9m2',
   '{"bed_master_min_m2":12,"bed_secondary_min_m2":9}',
   '/refs/tcvn/4451_2012.pdf','2,3',
   'medium'),

  -- ===== TCVN 4513 — Cap nuoc trong nha (2 rules) =====
  ('tr_4513_01','TCVN 4513','1988','plumbing',
   'Hanh lang nha o: rong >= 900mm',
   '{"var":"corridor_w","min":900,"unit":"mm"}',
   '/refs/tcvn/4513.pdf','2,4',
   'high'),

  ('tr_4513_02','TCVN 4513','1988','plumbing',
   'Tam giac bep (sink-stove-fridge): chu vi <= 6m',
   '{"var":"kitchen_triangle","max":6,"unit":"m"}',
   '/refs/tcvn/4513.pdf','2',
   'medium'),

  -- ===== TCVN 9385:2012 — Chong set (2 rules) =====
  ('tr_9385_01','TCVN 9385','2012','lightning',
   'Nha cao >=20m hoac mai ton: phai co kim thu set LPS cap II tro len',
   '{"trigger":"H>=20||roof=metal","lps_class":"II"}',
   '/refs/tcvn/9385_2012.pdf','4',
   'critical'),

  ('tr_9385_02','TCVN 9385','2012','lightning',
   'Dien tro tiep dia chong set: <= 10 ohm (kho), <= 4 ohm (am)',
   '{"R_dry_max":10,"R_wet_max":4,"unit":"ohm"}',
   '/refs/tcvn/9385_2012.pdf','4',
   'high'),

  -- ===== Bonus: IEC 60364 (Dien) =====
  ('tr_iec_01','IEC 60364','2017','electric',
   'Sut ap toi da tu nguon den thiet bi: <= 3% (chieu sang) hoac 5% (dong luc)',
   '{"V_drop_lighting_pct":3,"V_drop_motor_pct":5}',
   '/refs/iec/60364.pdf','3',
   'high'),

  ('tr_iec_02','IEC 60364','2017','electric',
   'He so an toan tinh phu tai: k = 1.25',
   '{"var":"k","value":1.25}',
   '/refs/iec/60364.pdf','3',
   'medium');

-- HET 35 TCVN/QCVN/IEC rules.
