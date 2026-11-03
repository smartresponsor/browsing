// Central worker quiescence control; pure state machine, no browser or process control.
export function createWorkerDrainController() {
  let draining = false;
  let active = 0;
  function snapshot() {
    return Object.freeze({
      status: draining ? (active === 0 ? 'WORKER_DRAINED' : 'WORKER_DRAINING') : 'WORKER_ACTIVE',
      draining,
      activeOperations: active,
      drained: draining && active === 0
    });
  }
  return Object.freeze({
    snapshot,
    beginOperation() {
      if (draining) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
    drain() { draining = true; return snapshot(); },
    resume() { draining = false; return snapshot(); }
  });
}
