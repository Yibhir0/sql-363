# sql-363


export const getByJobId: RequestHandler<GetResultParams> = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(404).json({ message: 'Job not passed' });
    }

    const cached = await getJobResult<CachedJobResult>(jobId);

    if (cached) {
      return res.json({
        jobId,
        status: cached.payload.status,
        result: cached.payload.data,
      });
    }

    const job = await queue.getJob(jobId);

    if (job) {
      const state = await job.getState();
      if (state === 'failed') {
        return res.status(422).json({ jobId, status: 'failed', error: 'Job processing failed' });
      }
      if (['waiting', 'active', 'delayed'].includes(state)) {
        return res.json({ jobId, status: 'processing' });
      }
    }

    return res.status(410).json({ error: 'result expired' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error fetching result' });
  }
};

```

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Dispatch } from "react";

import { timelineReducer } from "../reducers/timelineReducer";
import { TimelineActionConstants } from "../types/actions";
import { computeTimelinePartialUpdate } from "../utils/timelineUtils";
import type {
  TimelineState,
  TimelineActionType,
  CourseCode,
  SemesterId,
  TimelineJobResponse,
  JobStatus,
  Pool,
  CourseMap,
  SemesterList,
  CourseStatusValue,
  Degree,
} from "../types/timeline.types";
import { api } from "../api/http-api-client.ts";

type TimelineDispatch = Dispatch<TimelineActionType>;

export interface TimelineActions {
  initTimelineState: (
    timelineName: string,
    degree: Degree,
    pools: Pool[],
    courses: CourseMap,
    semesters: SemesterList,
  ) => void;
  selectCourse: (courseId: CourseCode | null) => void;
  moveFromPoolToSemester: (
    courseId: CourseCode,
    toSemesterId: SemesterId,
  ) => void;
  moveBetweenSemesters: (
    courseId: CourseCode,
    fromSemesterId: SemesterId,
    toSemesterId: SemesterId,
  ) => void;
  removeFromSemester: (courseId: CourseCode, semesterId: SemesterId) => void;
  undo: () => void;
  redo: () => void;
  openModal: (open: boolean, type: string) => void;
  changeCourseStatus: (courseId: CourseCode, status: CourseStatusValue) => void;
  addCourse: (courseId: CourseCode, type: string) => void;
  addSemester: () => void;
  setTimelineName: (timelineName: string) => void;
}

export interface UseTimelineStateResult {
  status: JobStatus;
  state: TimelineState;
  actions: TimelineActions;
  canUndo: boolean;
  canRedo: boolean;
  errorMessage: string | null;
}

const EMPTY_TIMELINE_STATE: TimelineState = {
  timelineName: "",
  degree: {
    name: "",
    totalCredits: 0,
    coursePools: [],
  },
  pools: [],
  courses: {},
  semesters: [],
  selectedCourse: null,
  history: [],
  future: [],
  modal: {
    open: false,
    type: "",
  },
};

function createTimelineActions(dispatch: TimelineDispatch): TimelineActions {
  return {
    initTimelineState(timelineName, degree, pools, courses, semesters) {
      dispatch({
        type: TimelineActionConstants.Init,
        payload: { timelineName, degree, pools, courses, semesters },
      });
    },
    selectCourse(courseId) {
      dispatch({
        type: TimelineActionConstants.SelectCourse,
        payload: { courseId },
      });
    },
    moveFromPoolToSemester(courseId, toSemesterId) {
      dispatch({
        type: TimelineActionConstants.MoveFromPoolToSemester,
        payload: { courseId, toSemesterId },
      });
    },
    moveBetweenSemesters(courseId, fromSemesterId, toSemesterId) {
      dispatch({
        type: TimelineActionConstants.MoveBetweenSemesters,
        payload: { courseId, fromSemesterId, toSemesterId },
      });
    },
    removeFromSemester(courseId, semesterId) {
      dispatch({
        type: TimelineActionConstants.RemoveFromSemester,
        payload: { courseId, semesterId },
      });
    },
    undo() {
      dispatch({ type: TimelineActionConstants.Undo });
    },
    redo() {
      dispatch({ type: TimelineActionConstants.Redo });
    },
    openModal(open, type) {
      dispatch({
        type: TimelineActionConstants.OpenModal,
        payload: { open, type },
      });
    },
    changeCourseStatus(courseId, status) {
      dispatch({
        type: TimelineActionConstants.ChangeCourseStatus,
        payload: { courseId, status },
      });
    },
    addCourse(courseId, type) {
      dispatch({
        type: TimelineActionConstants.AddCourse,
        payload: { courseId, type },
      });
    },
    addSemester() {
      dispatch({ type: TimelineActionConstants.AddSemester });
    },
    setTimelineName(timelineName: string) {
      dispatch({
        type: TimelineActionConstants.SetTimelineName,
        payload: { timelineName },
      });
    },
  };
}

export function useTimelineState(jobId?: string): UseTimelineStateResult {
  const [status, setStatus] = useState<JobStatus>("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const [state, dispatch] = useReducer(timelineReducer, EMPTY_TIMELINE_STATE);

  const actions = useMemo(() => createTimelineActions(dispatch), []);

  const prevStateRef = useRef<TimelineState | null>(null);

  // Polling effect — uses a loop instead of recursion, no AbortController
  useEffect(() => {
    if (!jobId || initialized) return;

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const start = Date.now();

      while (!cancelled && Date.now() - start <= 60_000) {
        try {
          const data = await api.get<TimelineJobResponse>(`/jobs/${jobId}`);
          if (cancelled) return;

          if (data.status === "done" && data.result) {
            const { degree, pools, courses, semesters } = data.result;
            dispatch({
              type: TimelineActionConstants.Init,
              payload: {
                timelineName: data.result.timelineName ?? "",
                degree,
                pools,
                courses,
                semesters,
              },
            });
            // Set the sync baseline to the initialized state so the
            // sync effect doesn't POST the entire initial payload back.
            prevStateRef.current = null; // will be set on next sync render
            setInitialized(true);
            setStatus("done");
            return;
          }

          if (data.status === "failed") {
            setStatus("failed");
            setErrorMessage("Job failed. Please try again.");
            return;
          }
        } catch (err) {
          if (cancelled) return;
          setStatus("failed");
          setErrorMessage(
            err instanceof Error && err.message.includes("HTTP 410")
              ? "Timeline generation expired. Please try again."
              : "Unable to reach server. Please try again.",
          );
          return;
        }

        // Wait before next poll, but track the timer so cleanup can clear it
        await new Promise<void>((resolve) => {
          timerId = setTimeout(() => {
            timerId = null;
            resolve();
          }, 1_500);
        });
      }

      if (!cancelled) {
        setStatus("failed");
        setErrorMessage("Processing is taking too long. Please try again.");
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [jobId, initialized]);

  // Sync effect — skips the first render after init so we don't POST the
  // initial state back to the server
  useEffect(() => {
    if (!jobId || !initialized) return;

    const prev = prevStateRef.current;
    prevStateRef.current = state;

    // Skip the first render after initialization
    if (!prev) return;

    const update = computeTimelinePartialUpdate(prev, state);
    if (update) {
      api.post(`/jobs/${jobId}`, update).catch((err) => {
        console.error("Failed to sync timeline update", err);
        setErrorMessage("Failed to save changes. Please try again.");
      });
    }
  }, [state, jobId, initialized]);

  return {
    status,
    state,
    actions,
    canUndo: state.history.length > 0,
    canRedo: state.future.length > 0,
    errorMessage,
  };
}


```
```
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useTimelineState } from "../../hooks/useTimelineState";
import { TimelineActionConstants } from "../../types/actions";

vi.mock("../../api/http-api-client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("../../reducers/timelineReducer", () => ({
  timelineReducer: (state: any, action: any) => {
    if (action.type === TimelineActionConstants.Init) {
      return {
        ...state,
        ...action.payload,
        modal: { open: false, type: "" },
        history: [],
        future: [],
        selectedCourse: null,
      };
    }
    if (action.type === TimelineActionConstants.ChangeCourseStatus) {
      const { courseId, status } = action.payload;
      return {
        ...state,
        courses: {
          ...state.courses,
          [courseId]: {
            ...state.courses[courseId],
            status: {
              ...state.courses[courseId].status,
              status,
            },
          },
        },
      };
    }
    if (action.type === TimelineActionConstants.SetTimelineName) {
      return {
        ...state,
        timelineName: action.payload.timelineName,
      };
    }
    return state;
  },
}));

import { api } from "../../api/http-api-client";

const POLL_INTERVAL = 1500;

const makeDoneResponse = (overrides: Record<string, any> = {}) => ({
  status: "done",
  result: {
    degree: { name: "CS", totalCredits: 90, coursePools: [] },
    pools: [],
    courses: {
      "COMP 248": {
        id: "COMP 248",
        title: "OOP",
        credits: 3,
        description: "",
        offeredIN: [],
        prerequisites: [],
        corequisites: [],
        status: { status: "completed", semester: "FALL 2025" },
      },
    },
    semesters: [{ term: "FALL 2025", courses: [] }],
    timelineName: "Saved Timeline",
    ...overrides,
  },
});

describe("useTimelineState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not poll when jobId is missing", () => {
    renderHook(() => useTimelineState(undefined));
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL);
    });
    expect(api.get).not.toHaveBeenCalled();
  });

  it("fetches immediately then initializes timeline when job is done", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeDoneResponse() as any);

    const { result } = renderHook(() => useTimelineState("job-1"));

    await act(async () => {});

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("done");
    expect(result.current.state.timelineName).toBe("Saved Timeline");
    expect(result.current.state.courses["COMP 248"]).toBeDefined();
  });

  it("fails immediately on network error", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Network failure"));

    const { result } = renderHook(() => useTimelineState("job-err"));

    await act(async () => {});

    expect(result.current.status).toBe("failed");
    expect(result.current.errorMessage).toMatch(/unable to reach server/i);
  });

  it("shows expiration message for HTTP 410 errors", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("HTTP 410: Gone"));

    const { result } = renderHook(() => useTimelineState("job-410"));

    await act(async () => {});

    expect(result.current.status).toBe("failed");
    expect(result.current.errorMessage).toMatch(/expired/i);
  });

  it("fails when job status is failed", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ status: "failed" } as any);

    const { result } = renderHook(() => useTimelineState("job-fail"));

    await act(async () => {});

    expect(result.current.status).toBe("failed");
    expect(result.current.errorMessage).toMatch(/job failed/i);
  });

  it("polls while processing then resolves on done", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ status: "processing" } as any)
      .mockResolvedValueOnce(makeDoneResponse() as any);

    const { result } = renderHook(() => useTimelineState("job-poll"));

    // First fetch — processing
    await act(async () => {});
    expect(result.current.status).toBe("processing");

    // Advance past the poll delay, let the next fetch resolve
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL);
    });

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("done");
    expect(result.current.state.timelineName).toBe("Saved Timeline");
  });

  it("posts partial updates after state changes", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeDoneResponse({
        pools: [
          { _id: "exemptions", name: "exemptions", creditsRequired: 0, courses: [] },
          { _id: "deficiencies", name: "deficiencies", creditsRequired: 0, courses: [] },
        ],
      }) as any,
    );
    vi.mocked(api.post).mockResolvedValue({} as any);

    const { result } = renderHook(() => useTimelineState("job-3"));

    await act(async () => {});

    act(() => {
      result.current.actions.changeCourseStatus("COMP 248", "planned");
    });

    expect(api.post).toHaveBeenCalledWith(
      "/jobs/job-3",
      expect.objectContaining({
        courses: expect.any(Object),
      }),
    );
  });

  it("falls back to empty timelineName when missing", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeDoneResponse({ timelineName: undefined, courses: {}, semesters: [] }) as any,
    );

    const { result } = renderHook(() => useTimelineState("job-no-name"));

    await act(async () => {});

    expect(result.current.status).toBe("done");
    expect(result.current.state.timelineName).toBe("");
  });

  it("falls back to empty timelineName when null", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeDoneResponse({ timelineName: null, courses: {}, semesters: [] }) as any,
    );

    const { result } = renderHook(() => useTimelineState("job-null-name"));

    await act(async () => {});

    expect(result.current.status).toBe("done");
    expect(result.current.state.timelineName).toBe("");
  });

  it("updates timelineName via setTimelineName action", () => {
    const { result } = renderHook(() => useTimelineState(undefined));

    act(() => {
      result.current.actions.setTimelineName("My Timeline");
    });

    expect(result.current.state.timelineName).toBe("My Timeline");
  });
});
```
