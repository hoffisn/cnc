import { describe, expect, it } from 'vitest';
import { StockMaterial, findCuttingToolPreset, recommendCuttingParameters } from '@core/domain/design/cuttingLibrary';

describe('recommendCuttingParameters', () => {
  it('gives each tooth its chip at the spindle speed and slows down for harder material', () => {
    const tool = findCuttingToolPreset('end-mill-3.175-2');
    if (!tool) throw new Error('a library tool was expected');

    const softwood = recommendCuttingParameters(tool, StockMaterial.Softwood, 10000);
    expect(softwood).toEqual({ feedRate: 1020, plungeFeedRate: 310, depthPerPassMm: 1.6 });

    const aluminum = recommendCuttingParameters(tool, StockMaterial.Aluminum, 10000);
    expect(aluminum.feedRate).toBeLessThan(softwood.feedRate / 3);
    expect(aluminum.depthPerPassMm).toBeCloseTo(0.3);
  });
});
