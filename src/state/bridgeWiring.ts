import type { Bridge } from "../services/bridge";
import type { ServicesStore } from "./serviceStore";

let generation = 0;
let wireCount = 0;
let teardown: (() => void) | null = null;

export function wireBridge(bridge: Bridge, store: ServicesStore): () => void {
  const myGeneration = generation;
  wireCount += 1;
  if (wireCount === 1) {
    const unlisten = [
      bridge.onStatus((s) => store.applyStatus(s)),
      bridge.onOutput((o) => store.applyOutput(o)),
      bridge.onError((e) => store.applyError(e)),
    ];
    teardown = () => {
      for (const un of unlisten) {
        un();
      }
    };
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    if (myGeneration !== generation) {
      return;
    }
    wireCount -= 1;
    if (wireCount === 0 && teardown) {
      teardown();
      teardown = null;
    }
  };
}

export function resetBridgeWiring(): void {
  generation += 1;
  if (teardown) {
    teardown();
    teardown = null;
  }
  wireCount = 0;
}
