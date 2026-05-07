// TCVN Rules Engine — Types
// Viet-Contech Design Platform

export type Severity = 'info' | 'warn' | 'error' | 'critical';

export type RuleStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface RuleReference {
  tcvn: string;
  page?: number;
  section?: string;
}

export interface Rule {
  code: string;
  version: string;
  statement_vi: string;
  statement_en: string;
  formula?: string;
  inputs: string[];
  expected: unknown;
  severity: Severity;
  references: RuleReference;
}

export interface RuleSet {
  category: string;
  standard: string;
  title_vi: string;
  title_en: string;
  version: string;
  rules: Rule[];
}

export interface RuleResult {
  rule_code: string;
  category: string;
  standard: string;
  status: RuleStatus;
  severity: Severity;
  actual: unknown;
  expected: unknown;
  statement_vi: string;
  suggestion?: string;
  message?: string;
}

export interface DesignInput {
  // Building meta
  building_type?: 'residential' | 'office' | 'medical' | 'wooden' | 'public';
  num_floors?: number;
  building_height_m?: number;
  lot_area_m2?: number;
  floor_area_m2?: number;

  // Concrete & rebar
  concrete_grade?: 'B15' | 'B20' | 'B25' | 'B30' | 'B40';
  cover_mm?: number;
  cover_outdoor_mm?: number;
  cover_slab_mm?: number;
  phi_long_column_mm?: number;
  phi_long_beam_mm?: number;
  phi_stirrup_mm?: number;
  mu_column_pct?: number;
  spacing_stirrup_mm?: number;
  span_beam_mm?: number;
  deflection_live_mm?: number;
  deflection_total_mm?: number;
  column_b_mm?: number;
  column_h_mm?: number;
  slab_thickness_mm?: number;
  rebar_spacing_slab_mm?: number;

  // Loads
  live_load_kn_m2?: number;
  W0_kn_m2?: number;
  wind_zone?: string;
  gamma_DL?: number;
  gamma_LL?: number;

  // Fire
  max_distance_to_exit_m?: number;
  exit_door_width_m?: number;
  corridor_width_m?: number;
  occupants_per_floor?: number;
  num_exits?: number;
  column_fire_resistance_R?: string;
  beam_fire_resistance_R?: string;
  has_sprinkler?: boolean;
  has_fire_alarm?: boolean;
  exit_door_opens_outward?: boolean;
  exit_clear_height_m?: number;
  emergency_lighting?: boolean;
  has_fire_water_supply?: boolean;

  // Energy
  EUI_kwh_m2_year?: number;
  U_wall_w_m2_k?: number;
  U_roof_w_m2_k?: number;
  SHGC_south?: number;
  WWR_pct?: number;
  LED_lm_w?: number;
  AC_COP?: number;
  LPD_w_m2?: number;

  // Planning
  coverage_pct?: number;
  front_setback_m?: number;
  rear_setback_m?: number;
  side_setback_m?: number;
  green_ratio_pct?: number;

  // Housing
  ceiling_main_room_m?: number;
  ceiling_aux_room_m?: number;
  window_area_m2?: number;
  master_bedroom_m2?: number;
  secondary_bedroom_m2?: number;
  kitchen_area_m2?: number;
  kitchen_ventilation?: boolean;
  master_wc_m2?: number;
  aux_wc_m2?: number;
  living_room_m2?: number;
  internal_door_width_m?: number;

  // Lightning
  LPS_class?: 'I' | 'II' | 'III' | 'IV' | 'NONE';
  earth_resistance_ohm?: number;
  num_down_conductors?: number;
  down_conductor_section_mm2?: number;
  earth_electrode_spacing_m?: number;
  air_terminal_distance_m?: number;

  // Free-form
  [key: string]: unknown;
}

export interface ValidationReport {
  total_rules: number;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
  results: RuleResult[];
}
