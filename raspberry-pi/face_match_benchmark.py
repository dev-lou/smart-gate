"""
Face Match Benchmark
====================
Quick benchmark for face matching cost as enrolled population grows.
This simulates 128-d embeddings and measures comparison time.
"""

import time
import numpy as np


def benchmark(population_sizes=(500, 1000, 2000, 5000), runs=200):
    print("Face Match Benchmark (vectorized distance)")
    print("----------------------------------------")

    for n in population_sizes:
        known = np.random.rand(n, 128).astype(np.float64)
        probe = np.random.rand(128).astype(np.float64)

        # Warm-up
        _ = np.linalg.norm(known - probe, axis=1)

        start = time.perf_counter()
        for _ in range(runs):
            distances = np.linalg.norm(known - probe, axis=1)
            _ = int(np.argmin(distances))
        elapsed = time.perf_counter() - start

        avg_ms = (elapsed / runs) * 1000.0
        est_fps = 1000.0 / avg_ms if avg_ms > 0 else 0.0

        print(f"N={n:>5} -> avg compare {avg_ms:>7.3f} ms | theoretical max {est_fps:>7.1f} compares/s")


if __name__ == "__main__":
    benchmark()
