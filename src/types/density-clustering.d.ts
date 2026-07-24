declare module 'density-clustering' {
  export type DistanceFunction<T = number[]> = (a: T, b: T) => number;
  export class DBSCAN {
    run(dataset: number[][], neighborhoodRadius: number, minPoints: number, distanceFunction: DistanceFunction): number[][];
  }
  export class KMEANS {
    run(dataset: number[][], k: number, distanceFunction: DistanceFunction): number[][];
  }
}
