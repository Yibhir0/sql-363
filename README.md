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

/* -------------------- TYPES -------------------- */

type TimelineDispatch = Dispatch<TimelineActionType>;

/* -------------------- CONSTANTS -------------------- */

const POLL_INTERVAL = 1500;
const MAX_DURATION = 60_000;

/* -------------------- EMPTY STATE -------------------- */

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

/* -------------------- ACTIONS -------------------- */

function createTimelineActions(dispatch: TimelineDispatch) {
  return {
    initTimelineState(
      timelineName: string,
      degree: Degree,
      pools: Pool[],
      courses: CourseMap,
      semesters: SemesterList,
    ) {
      dispatch({
        type: TimelineActionConstants.Init,
        payload: { timelineName, degree, pools, courses, semesters },
      });
    },

    selectCourse(courseId: CourseCode | null) {
      dispatch({
        type: TimelineActionConstants.SelectCourse,
        payload: { courseId },
      });
    },

    moveFromPoolToSemester(courseId: CourseCode, toSemesterId: SemesterId) {
      dispatch({
        type: TimelineActionConstants.MoveFromPoolToSemester,
        payload: { courseId, toSemesterId },
      });
    },

    moveBetweenSemesters(
      courseId: CourseCode,
      fromSemesterId: SemesterId,
      toSemesterId: SemesterId,
    ) {
      dispatch({
        type: TimelineActionConstants.MoveBetweenSemesters,
        payload: { courseId, fromSemesterId, toSemesterId },
      });
    },

    removeFromSemester(courseId: CourseCode, semesterId: SemesterId) {
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

    openModal(open: boolean, type: string) {
      dispatch({
        type: TimelineActionConstants.OpenModal,
        payload: { open, type },
      });
    },

    changeCourseStatus(courseId: CourseCode, status: CourseStatusValue) {
      dispatch({
        type: TimelineActionConstants.ChangeCourseStatus,
        payload: { courseId, status },
      });
    },

    addCourse(courseId: CourseCode, type: string) {
      dispatch({
        type: TimelineActionConstants.AddCourse,
        payload: { courseId, type },
      });
    },

    addSemester() {
      dispatch({
        type: TimelineActionConstants.AddSemester,
      });
    },

    setTimelineName(timelineName: string) {
      dispatch({
        type: TimelineActionConstants.SetTimelineName,
        payload: { timelineName },
      });
    },
  };
}

/* -------------------- HOOK -------------------- */

export function useTimelineState(jobId?: string) {
  const [status, setStatus] = useState<JobStatus>("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const [state, dispatch] = useReducer(timelineReducer, EMPTY_TIMELINE_STATE);

  const actions = useMemo(() => createTimelineActions(dispatch), [dispatch]);

  /* -------------------- POLLING CONTROL -------------------- */

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!jobId || initialized) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const start = Date.now();

    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const run = async () => {
      try {
        while (!controller.signal.aborted) {
          if (Date.now() - start > MAX_DURATION) {
            setStatus("failed");
            setErrorMessage("Processing took too long.");
            return;
          }

          const data = await api.get<TimelineJobResponse>(`/jobs/${jobId}`);

          if (controller.signal.aborted) return;

          if (data.status === "done" && data.result) {
            const { degree, pools, courses, semesters } = data.result;

            actions.initTimelineState(
              data.result.timelineName ?? "",
              degree,
              pools,
              courses,
              semesters,
            );

            setStatus("done");
            setInitialized(true);
            return;
          }

          if (data.status === "failed") {
            setStatus("failed");
            setErrorMessage("Job failed. Please try again.");
            return;
          }

          setStatus("processing");
          await sleep(POLL_INTERVAL);
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        setStatus("failed");
        setErrorMessage(
          err instanceof Error && err.message.includes("HTTP 410")
            ? "Timeline generation expired."
            : "Unable to reach server.",
        );
      }
    };

    run();

    return () => {
      controller.abort();
    };
  }, [jobId, initialized, actions]);

  /* -------------------- PARTIAL SYNC -------------------- */

  const prevStateRef = useRef<TimelineState | null>(null);

  useEffect(() => {
    if (!jobId || !initialized) return;

    const prev = prevStateRef.current;

    if (!prev) {
      prevStateRef.current = state;
      return;
    }

    const update = computeTimelinePartialUpdate(prev, state);

    if (update) {
      api.post(`/jobs/${jobId}`, update).catch((err) => {
        console.error("Failed to sync timeline update", err);
      });
    }

    prevStateRef.current = state;
  }, [state, jobId, initialized]);

  /* -------------------- DERIVED STATE -------------------- */

  const canUndo = state.history.length > 0;
  const canRedo = state.future.length > 0;

  return {
    status,
    state,
    actions,
    canUndo,
    canRedo,
    errorMessage,
  };
}
```

