const mockMongooseConnect = jest.fn();
const mockMongooseClose = jest.fn();
const mockConnectJobRedis = jest.fn();
const mockWorkerClose = jest.fn();
const mockSentryInit = jest.fn();
const mockSentryCapture = jest.fn();

jest.mock('mongoose', () => ({
  connect: mockMongooseConnect,
  connection: { close: mockMongooseClose },
}));

jest.mock('@lib/redisClient', () => ({
  connectJobRedis: mockConnectJobRedis,
}));

jest.mock('./workers/queue', () => ({
  courseProcessorWorker: { close: mockWorkerClose },
}));

jest.mock('@sentry/node', () => ({
  __esModule: true,
  default: { init: mockSentryInit, captureException: mockSentryCapture },
}));

jest.mock('dotenv');

describe('Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMongooseConnect.mockResolvedValue(undefined);
    mockConnectJobRedis.mockResolvedValue(undefined);
  });

  it('initializes Sentry', () => {
    jest.isolateModules(() => {
      require('../workers/worker');
      expect(mockSentryInit).toHaveBeenCalled();
    });
  });
});
