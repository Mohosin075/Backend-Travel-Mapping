import axios from 'axios'
import https from 'https'
import config from '../config'

interface GeocodingResult {
  lat: number
  lng: number
  formattedAddress: string
}

export const geocodeAddress = async (
  location: string,
): Promise<GeocodingResult | null> => {
  try {
    const agent = new https.Agent({ family: 4 })
    const API_KEY = config.server_map_api_key

    const response = await axios.get(
      'https://maps.googleapis.com/maps/api/geocode/json',
      {
        params: {
          address: location.trim(),
          key: API_KEY,
        },
        httpsAgent: agent,
      },
    )

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0]
      const { lat, lng } = result.geometry.location

      return {
        lat: lat,
        lng: lng,
        formattedAddress: result.formatted_address,
      }
    }

    return null
  } catch (error) {
    console.error('Geocoding error:', error)
    return null
  }
}
