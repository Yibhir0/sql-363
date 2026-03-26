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


useEffect(() => {
  if (!jobId || initialized) return;

  let cancelled = false;
  const start = Date.now();

  const fetchResult = async (): Promise<void> => {
    if (cancelled || Date.now() - start > 60_000) {
      if (!cancelled) {
        setStatus("error");
        setErrorMessage("Processing is taking too long. Please try again.");
      }
      return;
    }

    try {
      const data = await api.get<TimelineJobResponse>(`/jobs/${jobId}`);
      if (cancelled) return;

      if (data.status === "done" && data.result) {
        const { degree, pools, courses, semesters } = data.result;
        actions.initTimelineState(
          data.result.timelineName ?? "",
          degree,
          pools,
          courses,
          semesters,
        );
        setInitialized(true);
        setStatus("done");
        return;
      }

      if (data.status === "processing") {
        await new Promise((r) => setTimeout(r, 1_500));
        return fetchResult();
      }

      setStatus("error");
      setErrorMessage("Job failed. Please try again.");
    } catch (err) {
      if (cancelled) return;
      setStatus("error");
      setErrorMessage(
        err instanceof Error && err.message.includes("HTTP 410")
          ? "Timeline generation expired. Please try again."
          : "Unable to reach server. Please try again.",
      );
    }
  };

  fetchResult();

  return () => { cancelled = true; };
}, [jobId, initialized, actions]);

