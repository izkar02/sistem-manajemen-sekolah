// src/models/ga.ts
export interface Gene {
  classIdx: number;
  subjectName: string;
  teacherName: string;
  day: number;
  period: number;
}

export interface Chromosome {
  genes: Gene[];
  fitness: number;
}

export interface GAResult {
  assignments: Gene[];
  fitness: number;
  generations: number;
  durationMs: number; // lama waktu proses algoritma genetika berjalan (dalam milidetik)
}
