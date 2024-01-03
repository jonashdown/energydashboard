import * as functions from '@google-cloud/functions-framework';

const interval = 1800; // 30 mins in seconds

const isoDate = (date) => date.toJSON().split(':').slice(0, 2).join(':').concat('Z');

const convertDateToSeconds = (input) => Math.round(new Date(input).getTime() / 1000);

const getCarbonIntensityURL = (postcode) => {
  const carbonIntensityAPI = process.env.CARBON_INTENSITY_API;
  const now = new Date();
  return `${carbonIntensityAPI}/regional/intensity/${isoDate(now)}/pt24h/postcode/${postcode}`;
};

const getCarbonIntensityDataForPostcode = async (postcode = process.env.POSTCODE) => {

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

const convertFuelData = ({ fuel, perc }, time, postcode) => ({
  name: fuel,
  interval,
  value: perc,
  tags: ['type=generation', `postcode=${postcode}`, 'data-source=carbonintensity.generation'],
  time
});

const convertIntensityData = ({ forecast }, time, postcode) => ({
  name: 'intensity',
  interval,
  value: forecast,
  tags: ['type=intensity', `postcode=${postcode}`, 'data-source=carbonintensity.intensity'],
  time
});

const prepareData = ({ data, postcode }) => {
  const time = convertDateToSeconds(data.to);

  return data.map(({ intensity, generationmix }) => [
    convertIntensityData(intensity, time, postcode),
    ...generationmix.map((fuelData) => convertFuelData(fuelData, time, postcode))
  ]).flat();
};

const sendToGrafana = async (data) => {
  try {
    const response = await fetch(process.env.GRAFANA_API, {
      method: 'post',
      body: JSON.stringify(data),
      headers: {
        'Authorization': `Bearer ${process.env.GRAFANA_USER_ID}:${process.env.GRAFANA_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });
    console.log(`Succesfull POST to ${process.env.GRAFANA_API}`, response.status, response.statusText);
    return response.statusText
  } catch (error) {
    console.error(`Error response from ${process.env.GRAFANA_API}`, error);
    throw error;
  }
}

export const handler = async () => {
  const { data } = await getCarbonIntensityDataForPostcode();
  const carbonIntensity = prepareData(data);
  return await sendToGrafana(carbonIntensity);
};

functions.cloudEvent('carbonIntensityIngest', handler)
