import { expect, type Page } from './fixtures';

type RestorableSetItem = typeof Storage.prototype.setItem & {
  __logbookE2eNativeSetItem?: typeof Storage.prototype.setItem;
};

/**
 * Stop the real Chromium writer immediately before native localStorage.setItem.
 * No reads, ciphertext or production guards are replaced. Callers can
 * synchronize writers or close a realm at an observed publication boundary.
 */
export async function pauseStorageWrite(page: Page, prefix: string, valueFragment?: string) {
  const session = await page.context().newCDPSession(page);
  let released = false;
  let installed = false;

  const restoreStorageSetter = async () => {
    if (!installed || page.isClosed()) return;
    await page.evaluate(() => {
      const current = Storage.prototype.setItem as RestorableSetItem;
      const original = current.__logbookE2eNativeSetItem;
      if (original) Storage.prototype.setItem = original;
    });
    installed = false;
  };

  const cleanup = async () => {
    const failures: unknown[] = [];
    if (!released) {
      try { await session.send('Debugger.disable'); }
      catch (error) { failures.push(error); }
    }
    try { await session.detach(); }
    catch (error) { failures.push(error); }
    try { await restoreStorageSetter(); }
    catch (error) { if (!page.isClosed()) failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Cannot clean up storage write barrier');
  };

  try {
    await session.send('Debugger.enable');
    await page.evaluate(() => {
      const nativeSetItem = Storage.prototype.setItem as RestorableSetItem;
      if (nativeSetItem.__logbookE2eNativeSetItem) {
        throw new Error('Storage write barrier already installed in this document');
      }
      const wrapper = function(this: Storage, key: string, value: string) {
        return nativeSetItem.call(this, key, value);
      } as RestorableSetItem;
      // Detaching CDP does not undo a monkeypatch in a surviving document.
      Object.defineProperty(wrapper, '__logbookE2eNativeSetItem', { value: nativeSetItem });
      Storage.prototype.setItem = wrapper;
    });
    installed = true;

    const { result } = await session.send('Runtime.evaluate', {
      expression: 'Storage.prototype.setItem',
    });
    if (!result.objectId) throw new Error('Storage write boundary unavailable');

    let frame: string | undefined;
    let hitBreakpoints: string[] = [];
    let pauseCount = 0;
    // Register before arming the breakpoint, or an immediate pause can be lost.
    session.on('Debugger.paused', event => {
      frame = event.callFrames[0]?.callFrameId;
      hitBreakpoints = event.hitBreakpoints ?? [];
      pauseCount++;
    });
    const { breakpointId } = await session.send('Debugger.setBreakpointOnFunctionCall', {
      objectId: result.objectId,
      condition: `this === localStorage && arguments[0].startsWith(${JSON.stringify(prefix)})`
        + (valueFragment === undefined ? '' : ` && arguments[1].includes(${JSON.stringify(valueFragment)})`),
    });

    return {
      async wait() {
        await expect.poll(() => hitBreakpoints).toContain(breakpointId);
        if (!frame) throw new Error('Storage writer paused without a frame');
        const { result, exceptionDetails } = await session.send('Debugger.evaluateOnCallFrame', {
          callFrameId: frame,
          expression: '({ key: arguments[0], value: arguments[1], previous: this.getItem(arguments[0]) })',
          returnByValue: true,
        });
        if (exceptionDetails) throw new Error('Cannot inspect paused storage write');
        return result.value as { key: string; value: string; previous: string | null };
      },
      async publishAndPause() {
        if (!frame) throw new Error('Storage writer has not reached its boundary');
        const before = pauseCount;
        // Execute the real native write, then stop on the wrapper's return:
        // application callbacks and Auth handoff have not resumed yet.
        await session.send('Debugger.stepOver');
        await expect.poll(() => pauseCount).toBeGreaterThan(before);
      },
      async release() {
        await session.send('Debugger.removeBreakpoint', { breakpointId });
        if (frame) await session.send('Debugger.resume');
        released = true;
      },
      async dispose() {
        // After an assertion failure, disabling CDP resumes a paused target;
        // successful cleanup also restores native setItem on surviving pages.
        await cleanup();
      },
    };
  } catch (error) {
    try { await cleanup(); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Storage breakpoint setup and cleanup failed');
    }
    throw error;
  }
}
