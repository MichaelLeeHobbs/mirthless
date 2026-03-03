// ===========================================
// HL7 v2.5 Code Tables
// ===========================================
// Lookup tables for generating realistic HL7 messages.

export const MESSAGE_TYPES = {
  ADT_A01: { type: 'ADT', trigger: 'A01', segments: ['MSH', 'EVN', 'PID', 'PV1'] },
  ORM_O01: { type: 'ORM', trigger: 'O01', segments: ['MSH', 'PID', 'PV1', 'ORC', 'OBR'] },
  ORU_R01: { type: 'ORU', trigger: 'R01', segments: ['MSH', 'PID', 'PV1', 'OBR', 'OBX'] },
  SIU_S12: { type: 'SIU', trigger: 'S12', segments: ['MSH', 'SCH', 'PID', 'PV1', 'AIG'] },
} as const;

export type HL7MessageType = keyof typeof MESSAGE_TYPES;

export const FIRST_NAMES: readonly string[] = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer',
  'Michael', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara',
  'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah',
  'Charles', 'Karen',
];

export const LAST_NAMES: readonly string[] = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia',
  'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez',
  'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore',
  'Jackson', 'Martin',
];

export const SEX_CODES: readonly string[] = ['M', 'F', 'U'];

export const PATIENT_CLASS_CODES: readonly string[] = ['I', 'O', 'E', 'P', 'R'];

export const OBX_VALUE_TYPES: readonly string[] = ['NM', 'ST', 'CE', 'TX'];

export const FACILITY_NAMES: readonly string[] = [
  'GENERAL_HOSP', 'CITY_MEDICAL', 'MERCY_HEALTH', 'SAINT_LUKE',
  'VALLEY_CLINIC', 'METRO_HOSPITAL', 'SUMMIT_HEALTH', 'CEDAR_MEDICAL',
];

export const ROOM_NAMES: readonly string[] = [
  '101A', '102B', '201A', '202B', '301A', '302B', '401A', '402B',
];

export const BED_NAMES: readonly string[] = ['1', '2', '3', '4'];

export const ORDER_CODES: readonly string[] = [
  'CBC', 'BMP', 'CMP', 'UA', 'TSH', 'HBA1C', 'LIPID', 'PT_INR',
];

export const ORDER_NAMES: readonly string[] = [
  'Complete Blood Count', 'Basic Metabolic Panel', 'Comprehensive Metabolic Panel',
  'Urinalysis', 'Thyroid Stimulating Hormone', 'Hemoglobin A1c',
  'Lipid Panel', 'PT/INR',
];

export const OBX_IDENTIFIERS: readonly string[] = [
  'WBC', 'RBC', 'HGB', 'HCT', 'PLT', 'GLU', 'BUN', 'CRE',
];

export const OBX_NAMES: readonly string[] = [
  'White Blood Cells', 'Red Blood Cells', 'Hemoglobin', 'Hematocrit',
  'Platelets', 'Glucose', 'Blood Urea Nitrogen', 'Creatinine',
];

export const DOCTOR_NAMES: readonly string[] = [
  'SMITH^JOHN^A', 'JONES^SARAH^B', 'WILLIAMS^DAVID^C',
  'BROWN^LISA^D', 'DAVIS^MARK^E', 'WILSON^AMY^F',
];
