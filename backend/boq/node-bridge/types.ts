/**
 * types.ts - Shared TypeScript types for BOQ Node bridge
 * ======================================================
 * Mirror of Python output schema (extract.py / boq_generator.py).
 */
import { z } from 'zod';

// ============================================================
// EXTRACT (DXF -> Quantities) Schemas
// ============================================================
export const LayerQuantitySchema = z.object({
  layer: z.string(),
  entity_type: z.enum([
    'wall',
    'column',
    'beam',
    'slab',
    'door',
    'window',
    'floor_tile',
    'wall_tile',
    'paint',
    'ceiling',
    'light',
    'socket',
    'switch',
    'ac',
    'pipe',
    'wire',
    'glass',
    'railing',
    'foundation',
    'other',
  ]),
  count: z.number().int().nonnegative(),
  length_m: z.number().nonnegative(),
  area_m2: z.number().nonnegative(),
  volume_m3: z.number().nonnegative(),
  handles: z.array(z.string()).default([]),
  meta: z.record(z.string(), z.any()).default({}),
});

export type LayerQuantity = z.infer<typeof LayerQuantitySchema>;

export const QuantitiesSchema = z.object({
  dxf_file: z.string(),
  units: z.enum(['mm', 'm']),
  total_floor_area_m2: z.number().nonnegative(),
  floors_detected: z.number().int().positive(),
  bbox: z.object({
    min_x: z.number(),
    min_y: z.number(),
    max_x: z.number(),
    max_y: z.number(),
    width: z.number().nonnegative(),
    depth: z.number().nonnegative(),
  }),
  layers: z.record(z.string(), LayerQuantitySchema),
  warnings: z.array(z.string()).default([]),
});

export type Quantities = z.infer<typeof QuantitiesSchema>;

// ============================================================
// BOQ Schemas
// ============================================================
export const BOQItemSchema = z.object({
  stt: z.number().int().nonnegative(),
  code: z.string(),
  description: z.string(),
  unit: z.string(),
  quantity: z.number().nonnegative(),
  wastage_pct: z.number().nonnegative(),
  quantity_with_wastage: z.number().nonnegative(),
  unit_price_vnd: z.number().int().nonnegative(),
  total_vnd: z.number().int().nonnegative(),
  material_id: z.string(),
  source_layer: z.string(),
  source_handles: z.array(z.string()).default([]),
});

export type BOQItem = z.infer<typeof BOQItemSchema>;

export const BOQSheetSchema = z.object({
  name: z.string(),
  category: z.enum(['phan-tho', 'hoan-thien', 'noi-that', 'mep']),
  items: z.array(BOQItemSchema),
  subtotal_vnd: z.number().int().nonnegative(),
});

export type BOQSheet = z.infer<typeof BOQSheetSchema>;

export const BOQReportSchema = z.object({
  project_meta: z.object({
    project_id: z.string(),
    project_name: z.string().optional(),
    floors: z.number().int().positive(),
    total_floor_area_m2: z.number().nonnegative(),
    style: z.string().optional(),
  }),
  sheets: z.array(BOQSheetSchema),
  summary: z.object({
    direct_cost_vnd: z.number().int().nonnegative(),
    vat_8pct_vnd: z.number().int().nonnegative(),
    management_5pct_vnd: z.number().int().nonnegative(),
    contingency_10pct_vnd: z.number().int().nonnegative(),
    grand_total_vnd: z.number().int().nonnegative(),
    total_items: z.number().int().nonnegative(),
  }),
  grand_total_vnd: z.number().int().nonnegative(),
});

export type BOQReport = z.infer<typeof BOQReportSchema>;

// ============================================================
// API request/response Schemas
// ============================================================
export const ExtractRequestSchema = z.object({
  dxf_url: z.string().url().or(z.string().startsWith('/')).or(z.string().regex(/^[A-Za-z]:[\\/]/)),
  project_id: z.string(),
});

export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;

export const GenerateRequestSchema = z.object({
  quantities: QuantitiesSchema,
  project_meta: z.object({
    project_id: z.string(),
    project_name: z.string().optional(),
    floors: z.number().int().positive(),
    total_floor_area_m2: z.number().nonnegative(),
    style: z.string().optional(),
  }),
  materials_override: z.record(z.string(), z.string()).optional(),
});

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

export const ExportRequestSchema = z.object({
  project_id: z.string(),
  revision_id: z.string().optional(),
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
  boq: BOQReportSchema,
});

export type ExportRequest = z.infer<typeof ExportRequestSchema>;
