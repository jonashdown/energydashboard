import { handler } from './index.js';
import { jest } from '@jest/globals';

const RestoreDate = Date.now;

const mockFetch = jest.spyOn(global, 'fetch');
const { stringify } = JSON;
const mockJsonStringify = jest.spyOn(JSON, 'stringify');

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
  mockFetch.mockResolvedValue({ json: jest.fn(() => mockData), status: 200, statusText: 'ok' });
  mockJsonStringify.mockImplementation(stringify);
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

      //testing dates is hard, and the body of fetch cant be a json object, so check JSON.stringify is called correctly, but omitting the time
      //Then check that fetch body is the return value of the last JSON.stringify call
      //N.B might need to keep track of the Nth value
      expect(JSON.stringify).toBeCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ interval: 1800, name: 'intensity', tags: ['type=intensity', 'postcode=RG10', 'data-source=carbonintensity.intensity'], value: 266, time: expect.any(Number) }),
          expect.objectContaining({ interval: 1800, name: 'gas', tags: ['type=generation', 'postcode=RG10', 'data-source=carbonintensity.generation'], value: 43.6, time: expect.any(Number) }),
          expect.objectContaining({ interval: 1800, name: 'coal', tags: ['type=generation', 'postcode=RG10', 'data-source=carbonintensity.generation'], value: 0.7, time: expect.any(Number) }),
          expect.objectContaining({ interval: 1800, name: 'biomass', tags: ['type=generation', 'postcode=RG10', 'data-source=carbonintensity.generation'], value: 4.2, time: expect.any(Number) }),
          expect.objectContaining({ interval: 1800, name: 'nuclear', tags: ['type=generation', 'postcode=RG10', 'data-source=carbonintensity.generation'], value: 17.6, time: expect.any(Number) }),
          expect.objectContaining({ interval: 1800, name: 'hydro', tags: ['type=generation', 'postcode=RG10', 'data-source=carbonintensity.generation'], value: 2.2, time: expect.any(Number) }),
          expect.objectContaining({ interval: 1800, name: 'imports', tags: ['type=generation', 'postcode=RG10', 'data-source=carbonintensity.generation'], value: 6.5, time: expect.any(Number) }),
          expect.objectContaining({ interval: 1800, name: 'other', tags: ['type=generation', 'postcode=RG10', 'data-source=carbonintensity.generation'], value: 0.3, time: expect.any(Number) }),
          expect.objectContaining({ interval: 1800, name: 'wind', tags: ['type=generation', 'postcode=RG10', 'data-source=carbonintensity.generation'], value: 6.8, time: expect.any(Number) }),
          expect.objectContaining({ interval: 1800, name: 'solar', tags: ['type=generation', 'postcode=RG10', 'data-source=carbonintensity.generation'], value: 18.1, time: expect.any(Number) })
        ])
      );

      expect(fetch).toBeCalledWith(
        process.env.GRAFANA_API,
        expect.objectContaining({
          headers: { Authorization: `Bearer ${process.env.GRAFANA_USER_ID}:${process.env.GRAFANA_API_KEY}`, 'Content-Type': 'application/json' },
          method: 'post',
          body: mockJsonStringify.mock.results.findLast(({ type }) => type==='return').value
        })
      )
    });

    it('throws an error when sending metrics fails', async () => {
      const thrownError = new Error('Grafana broke');
      mockFetch.mockResolvedValueOnce({ json: jest.fn(() => mockData), status: 200, statusText: 'ok' }).mockRejectedValue(thrownError);
      let caughtError;
      try {
        await handler();
      } catch (error) {
        caughtError = error;
      } finally {
        expect(caughtError).toEqual(thrownError);
        expect(fetch).toBeCalledTimes(2);
      }
    });
  });
});
