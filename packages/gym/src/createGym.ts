import {
  AnvilForkEnvironment,
  type AnvilForkEnvironmentOptions,
} from "./environment/AnvilForkEnvironment.js";
import {
  MultiChainForkEnvironment,
  type MultiChainForkEnvironmentOptions,
} from "./environment/MultiChainForkEnvironment.js";

export interface GymOptions {
  anvilBinary?: string;
}

export interface Gym {
  createEnvironment(
    options: Omit<AnvilForkEnvironmentOptions, "anvilBinary">,
  ): AnvilForkEnvironment;
  createMultiChainEnvironment(
    options: MultiChainForkEnvironmentOptions,
  ): MultiChainForkEnvironment;
}

export function createGym(options: GymOptions = {}): Gym {
  return {
    createEnvironment(environmentOptions) {
      return new AnvilForkEnvironment({
        ...environmentOptions,
        anvilBinary: options.anvilBinary,
      });
    },
    createMultiChainEnvironment(environmentOptions) {
      return new MultiChainForkEnvironment({
        chains: environmentOptions.chains.map((chain) => ({
          ...chain,
          anvilBinary: chain.anvilBinary ?? options.anvilBinary,
        })),
      });
    },
  };
}
