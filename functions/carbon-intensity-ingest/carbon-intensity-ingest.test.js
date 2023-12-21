import { handler } from './index.js';
import { jest } from '@jest/globals';

const RestoreDate = Date.now;

const mockFetch = jest.spyOn(global, 'fetch');

const { env } = process;

const date = new Date();
const fromDate = new Date();
fromDate.setMinutes(date.getMinutes() - 30);
const expectedDate = date.toISOString().slice(0, date.toISOString().lastIndexOf(':')).concat('Z');
const from = fromDate.toISOString().slice(0, fromDate.toISOString().lastIndexOf(':')).concat('Z');
const expectedTime = Math.round(date.getTime() / 1000);

const mockData = {
  data: {
    regionid: 3,
    dnoregion: 'Electricity North West',
    shortname: 'North West England',
    postcode: 'RG10',
    data: [
      {
        from,
        to: expectedDate,
        intensity: {
          forecast: 266,
          index: 'moderate'
        },
        generationmix: [
          { fuel: 'gas', perc: 43.6 },
          { fuel: 'coal', perc: 0.7 },
          { fuel: 'biomass', perc: 4.2 },
          { fuel: 'nuclear', perc: 17.6 },
          { fuel: 'hydro', perc: 2.2 },
          { fuel: 'imports', perc: 6.5 },
          { fuel: 'other', perc: 0.3 },
          { fuel: 'wind', perc: 6.8 },
          { fuel: 'solar', perc: 18.1 }
        ]
      }
    ]
  }
};

beforeAll(() => {
  process.env = {
    ...env,
    POSTCODE: 'RG10',
    CARBON_INTENSITY_API: 'https://api.carbonintensity.org.uk',
    GRAFANA_API: 'https://example.com/grafana',
    GRAFANA_USER_ID: 'bob',
    GRAFANA_API_KEY: 'abc123',
    TZ: 'GMT'
  };
  global.Date.now = jest.fn(() => new Date(date));
  jest.useFakeTimers();
  jest.setSystemTime(date);
})

beforeEach(() => {
  mockFetch.mockResolvedValue({ json: jest.fn(() => mockData) });
});

afterEach(() => {
  jest.resetAllMocks();
});

afterAll(() => {
  process.env = env;
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.Date.now = RestoreDate;
})
describe('Carbon Intensity Ingest', () => {

  describe('Calling the Carbon Intensity API', () => {
    it('Calls the Carbon Intensity API correctly', async () => {
      await handler();
      expect(fetch).toBeCalledWith(`${process.env.CARBON_INTENSITY_API}/regional/intensity/${expectedDate}/pt24h/postcode/${process.env.POSTCODE}`);
    });

    it('Throws an Error should the API call fail', async () => {
      const thrownError = new Error('something broke');
      fetch.mockRejectedValueOnce(thrownError);
      let caughtError;
      try {
        await handler();
      } catch (error) {
        caughtError = error;
      } finally {
        expect(caughtError).toEqual(thrownError);
        expect(fetch).toBeCalledTimes(1);
      }
    });
  });

  describe('Sends metrics to Graphite', () => {

    it('sends metrics to Grafana', async () => {
      await handler();
      expect(fetch).toBeCalledWith(
        process.env.GRAFANA_API,
        expect.objectContaining({
          headers: { Authorization: `Bearer ${process.env.GRAFANA_USER_ID}:${process.env.GRAFANA_API_KEY}`, 'Content-Type': 'application/json' },
          method: 'post',
          // body: expect.stringContaining('{ "interval": 1800, "name": "carbonintensity.intensity", "tags": ["type = intensity", "postcode = RG10", "data-source=carbonintensity.intensity"], "value": 266 }')
        })
        // {
        //   data: [
        //     expect.objectContaining({ interval: 1800, name: 'carbonintensity.intensity', tags: ['type=intensity', 'postcode=RG10'], value: 266 }),
        //     expect.objectContaining({ interval: 1800, name: 'carbonintensity.generation.gas', tags: ['type=generation', 'postcode=RG10'], value: 43.6 }),
        //     expect.objectContaining({ interval: 1800, name: 'carbonintensity.generation.coal', tags: ['type=generation', 'postcode=RG10'], value: 0.7 }),
        //     expect.objectContaining({ interval: 1800, name: 'carbonintensity.generation.biomass', tags: ['type=generation', 'postcode=RG10'], value: 4.2 }),
        //     expect.objectContaining({ interval: 1800, name: 'carbonintensity.generation.nuclear', tags: ['type=generation', 'postcode=RG10'], value: 17.6 }),
        //     expect.objectContaining({ interval: 1800, name: 'carbonintensity.generation.hydro', tags: ['type=generation', 'postcode=RG10'], value: 2.2 }),
        //     expect.objectContaining({ interval: 1800, name: 'carbonintensity.generation.imports', tags: ['type=generation', 'postcode=RG10'], value: 6.5 }),
        //     expect.objectContaining({ interval: 1800, name: 'carbonintensity.generation.other', tags: ['type=generation', 'postcode=RG10'], value: 0.3 }),
        //     expect.objectContaining({ interval: 1800, name: 'carbonintensity.generation.wind', tags: ['type=generation', 'postcode=RG10'], value: 6.8 }),
        //     expect.objectContaining({ interval: 1800, name: 'carbonintensity.generation.solar', tags: ['type=generation', 'postcode=RG10'], value: 18.1 })
        //   ],
        //   headers: { Authorization: `Bearer ${process.env.GRAFANA_USER_ID}:${process.env.GRAFANA_API_KEY}`, 'Content-Type': 'application/json' }
        // }
      )
    });

    it('throws an error when sending metrics fails', async () => {
      mockFetch.mockRejectedValue()
    });
  });
});
