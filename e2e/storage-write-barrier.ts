import { expect, type Page } from './fixtures';

/**
 * Stop the real Chromium writer immediately before native localStorage.setItem.
 * No reads, ciphertext or production guards are replaced. Each page has its
 * own debugger, so both realms must reach the boundary before either resumes.
 */
export async function pauseStorageWrite(page: Page, prefix: string, valueFragment?: string) {
  const session = await page.context().newCDPSession(page);
  await session.send('Debugger.enable');
  await page.evaluate(() => {
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(this: Storage, key: string, value: string) {
      return nativeSetItem.call(this, key, value);
    };
  });
  const { result } = await session.send('Runtime.evaluate', {
    expression: 'Storage.prototype.setItem',
  });
  if (!result.objectId) throw new Error('Storage write boundary unavailable');
  const { breakpointId } = await session.send('Debugger.setBreakpointOnFunctionCall', {
    objectId: result.objectId,
    condition: `this === localStorage && arguments[0].startsWith(${JSON.stringify(prefix)})`
      + (valueFragment === undefined ? '' : ` && arguments[1].includes(${JSON.stringify(valueFragment)})`),
  });
  let frame: string | undefined;
  let hitBreakpoints: string[] = [];
  session.on('Debugger.paused', event => {
    frame = event.callFrames[0]?.callFrameId;
    hitBreakpoints = event.hitBreakpoints ?? [];
  });
  let released = false;
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
    async release() {
      await session.send('Debugger.removeBreakpoint', { breakpointId });
      if (frame) await session.send('Debugger.resume');
      released = true;
    },
    async dispose() {
      // Detaching resumes a paused target even if an assertion or the other
      // writer failed. A failed barrier must never leave a hanging fill().
      if (!released) await session.send('Debugger.disable');
      await session.detach();
    },
  };
}
