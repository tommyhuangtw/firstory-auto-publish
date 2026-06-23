// Minimal type declarations for lunar-javascript (only the surface we use).
declare module 'lunar-javascript' {
  export class Solar {
    getYear(): number;
    getMonth(): number; // 1-based
    getDay(): number;
  }
  export class Lunar {
    static fromYmd(year: number, month: number, day: number): Lunar;
    getSolar(): Solar;
  }
}
