const mockMongooseConnect = jest.fn();
const mockMongooseClose = jest.fn();
const mockConnectJobRedis = jest.fn();
const mockWorkerClose = jest.fn();
const mockSentryInit = jest.fn();
const mockSentryCapture = jest.fn();

jest.mock('mongoose', () => ({
  connect: mockMongooseConnect,
  connection: {
    close: mockMongooseClose,
  },
}));

jest.mock('@lib/redisClient', () => ({
  connectJobRedis: mockConnectJobRedis,
}));

jest.mock('./workers/queue', () => ({
  courseProcessorWorker: {
    close: mockWorkerClose,
  },
}));

jest.mock('@sentry/node', () => ({
  init: mockSentryInit,
  captureException: mockSentryCapture,
}));

describe('Worker startup and shutdown', () => {
  let exitSpy;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    mockMongooseConnect.mockResolvedValue(undefined);
    mockConnectJobRedis.mockResolvedValue(undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('connects to MongoDB and Redis on start', async () => {
    await jest.isolateModulesAsync(async () => {
      await import('../workers/worker');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockMongooseConnect).toHaveBeenCalledWith(
        expect.stringContaining('mongodb://'),
      );
      expect(mockConnectJobRedis).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Worker connected to MongoDB');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Worker started and listening for jobs...',
      );
    });
  });

  it('exits on startup failure', async () => {
    mockMongooseConnect.mockRejectedValueOnce(new Error('DB connection failed'));

    await jest.isolateModulesAsync(async () => {
      await import('../workers/worker');
      await new Promise((resolve) => setImmediate(resolve));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to start worker:',
        expect.any(Error),
      );
      expect(mockSentryCapture).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
