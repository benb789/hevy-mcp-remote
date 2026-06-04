const HEVY_BASE = "https://api.hevyapp.com/v1";

export class HevyClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(path: string, query?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${HEVY_BASE}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, String(value));
      }
    }

    const res = await fetch(url, {
      headers: { "api-key": this.apiKey },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Hevy API ${res.status} ${res.statusText}: ${body || "no body"}`);
    }

    return res.json() as Promise<T>;
  }

  getWorkouts(page = 1, pageSize = 10) {
    return this.request("/workouts", { page, pageSize });
  }

  getWorkout(workoutId: string) {
    return this.request(`/workouts/${workoutId}`);
  }

  getRoutines(page = 1, pageSize = 10) {
    return this.request("/routines", { page, pageSize });
  }

  getExerciseTemplates(page = 1, pageSize = 100) {
    return this.request("/exercise_templates", { page, pageSize });
  }

  getWorkoutEvents(page = 1, pageSize = 10, since = "1970-01-01T00:00:00Z") {
    return this.request("/workouts/events", { page, pageSize, since });
  }
}
