"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCountryFromCoordinates = void 0;
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const config_1 = __importDefault(require("../config"));
/**
 * Get country name from coordinates using Google Maps Reverse Geocoding API
 * @param lat Latitude
 * @param lng Longitude
 * @returns Country name or null
 */
const getCountryFromCoordinates = async (lat, lng) => {
    try {
        const agent = new https_1.default.Agent({ family: 4 });
        const API_KEY = config_1.default.server_map_api_key;
        const response = await axios_1.default.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: {
                latlng: `${lat},${lng}`,
                key: API_KEY,
            },
            httpsAgent: agent,
            timeout: 4000,
        });
        if (response.data.status === 'OK' && response.data.results.length > 0) {
            // Loop through all results to find a country component
            for (const result of response.data.results) {
                const countryComponent = result.address_components.find((comp) => comp.types.includes('country'));
                if (countryComponent) {
                    return countryComponent.long_name;
                }
            }
        }
        return null;
    }
    catch (error) {
        console.error('Reverse geocoding error:', error);
        return null;
    }
};
exports.getCountryFromCoordinates = getCountryFromCoordinates;
