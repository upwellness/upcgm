import { createHash } from 'node:crypto';
import type { AnalysisResult, DataQuality, Reading } from '@/lib/types';
import { parseWorkbook } from './parse';
import { classifyFloorRuns, detectInterval, findGaps, flagSpikes, isMetricGrade } from './qc';
import { computeAgp, computeDaily, computeMetrics, findLowEvents } from './metrics';
import { MIN_CAPTURE_PCT, MIN_DAYS_FOR_METRICS } from './thresholds';
import { presetWindows } from './window';

/**
 * Identity of a reading set, not of a file. Re-uploading the same export gets
 * the same id so a coach's meal markers come back; a different wear gets a
 * different id so one client's markers can never land on another's chart.
 *
 * Deliberately not derived from the filename: real downloads arrive as
 * `OttaiCGM_<sensor-id> (1).xlsx` — the copy suffix alone would make the same
 * wear look like a new device.
 */
function fingerprint(readings: Reading[]): string {
  const sum = readings.reduce((acc, r) => acc + r.v, 0);
  return createHash('sha256')
    .update(`${readings[0].t}|${readings[readings.length - 1].t}|${readings.length}|${sum.toFixed(1)}`)
    .digest('hex')
    .slice(0, 16);
}

export function analyse(buf: Buffer, sourceName: string): AnalysisResult {
  const parsed = parseWorkbook(buf, sourceName);
  const readings = parsed.readings;

  // Order matters: floor runs are classified before spikes so a value already
  // explained as a dropout is not also counted as an impossible jump.
  const floorNotes = classifyFloorRuns(readings);
  const spikeNotes = flagSpikes(readings);
  const gaps = findGaps(readings);
  const intervalMinutes = detectInterval(readings);

  const spanMinutes = readings[readings.length - 1].t - readings[0].t;
  const spanDays = spanMinutes / 1440;
  const expected = Math.floor(spanMinutes / intervalMinutes) + 1;
  const capturePct = expected > 0 ? (readings.length / expected) * 100 : 0;

  const metrics = computeMetrics(readings);
  if (!metrics) {
    throw new Error('ไม่มีค่าที่ใช้คำนวณได้หลังตรวจคุณภาพข้อมูล');
  }

  const quality: DataQuality = {
    rowsRead: parsed.rowsRead,
    rowsUsed: readings.length,
    rejected: parsed.rejected,
    duplicatesDropped: parsed.duplicatesDropped,
    excludedFromMetrics: readings.filter((r) => !isMetricGrade(r)).length,
    gaps,
    qcNotes: [...floorNotes, ...spikeNotes],
    capturePct,
    spanDays,
    intervalMinutes,
    unitDetected: parsed.unitDetected,
    unitConverted: parsed.unitConverted,
    meetsFourteenDays: spanDays >= MIN_DAYS_FOR_METRICS,
    meetsSeventyPercent: capturePct >= MIN_CAPTURE_PCT,
  };

  return {
    datasetId: fingerprint(readings),
    sourceName,
    quality,
    // Parallel arrays: 3,000 objects on the wire is four times the bytes and a
    // few thousand needless allocations on an older phone.
    series: {
      t: readings.map((r) => r.t),
      v: readings.map((r) => r.v),
      flag: readings.map((r) => r.flag),
    },
    metrics,
    agp: computeAgp(readings),
    daily: computeDaily(readings, intervalMinutes),
    lowEvents: findLowEvents(readings),
    // Every preset is computed in this one pass so switching range on screen is
    // instant and cannot drift from the full-file numbers.
    windows: presetWindows(readings),
  };
}
