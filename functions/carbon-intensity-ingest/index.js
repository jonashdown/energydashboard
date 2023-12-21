import * as functions from '@google-cloud/functions-framework';

const isoDate = (date) => date.toJSON().split(':').slice(0, 2).join(':').concat('Z');

const getCarbonIntensityURL = (postcode) => {
  const carbonIntensityAPI = process.env.CARBON_INTENSITY_API;
  const now = new Date();
  return `${carbonIntensityAPI}/regional/intensity/${isoDate(now)}/pt24h/postcode/${postcode}`;
};

const getCarbonIntensityDataForpostcode = async (postcode) => {

  const carbonIntensityURL = getCarbonIntensityURL(postcode);
  console.log(`Fetching from ${carbonIntensityURL}`);

  try {
    const response = await fetch(carbonIntensityURL);
    console.log(`Succesful response from ${carbonIntensityURL}`);
    return response.json();
  } catch (error) {
    console.error(`Error response from ${carbonIntensityURL}`, error);
    throw error;
  }
};

const prepareData = ({ data, postcode }) => {
  const result = [];
  const interval = 1800; // 30 mins in seconds

  data.forEach(({ to, intensity, generationmix }) => {
    const date = new Date(to);
    const time = Math.round(date.getTime() / 1000);
    result.push(
      {
        name: 'intensity',
        interval,
        value: intensity.forecast,
        tags: ['type=intensity', `postcode=${postcode}`, 'data-source=carbonintensity.intensity'],
        time,
      },
      ...generationmix.map(({ fuel, perc }) => (
        {
          name: `${fuel}`,
          interval,
          value: perc,
          tags: ['type=generation', `postcode=${postcode}`, 'data-source=carbonintensity.generation'],
          time
        })
      )
    )
  });
  return result;
};

const sendToGrafana = async (data) => {
  try {
    const response = await fetch(process.env.GRAFANA_API, {
      method: 'post',
      body: JSON.stringify(data),
      headers: {
        'Authorization': `Bearer ${process.env.GRAFANA_USER_ID}:${process.env.GRAFANA_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    console.log(`Succesfull POST to ${process.env.GRAFANA_API}`, response.status, response.statusText);
    return response.statusText
  } catch (error) {
    console.error(`Error response from ${process.env.GRAFANA_API}`, error);
    throw error;
  }
}

export const handler = async () => {

  const postcode = process.env.POSTCODE;

  const { data } = await getCarbonIntensityDataForpostcode(postcode);
  const carbonIntensity = prepareData(data);
  return await sendToGrafana(carbonIntensity);
};

functions.cloudEvent('carbonIntensityIngest', handler)
