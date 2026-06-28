// Indian GST State Codes
export const INDIAN_STATES: Record<string, string> = {
  'Andhra Pradesh': '37', 'Arunachal Pradesh': '12', 'Assam': '18', 'Bihar': '10',
  'Chhattisgarh': '22', 'Goa': '30', 'Gujarat': '24', 'Haryana': '06',
  'Himachal Pradesh': '02', 'Jharkhand': '20', 'Karnataka': '29', 'Kerala': '32',
  'Madhya Pradesh': '23', 'Maharashtra': '27', 'Manipur': '14', 'Meghalaya': '17',
  'Mizoram': '15', 'Nagaland': '13', 'Odisha': '21', 'Punjab': '03',
  'Rajasthan': '08', 'Sikkim': '11', 'Tamil Nadu': '33', 'Telangana': '36',
  'Tripura': '16', 'Uttar Pradesh': '09', 'Uttarakhand': '05', 'West Bengal': '19',
  'Andaman and Nicobar Islands': '35', 'Chandigarh': '04', 'Dadra and Nagar Haveli and Daman and Diu': '26',
  'Delhi': '07', 'Jammu and Kashmir': '01', 'Ladakh': '38', 'Lakshadweep': '31',
  'Puducherry': '34',
};

// Major Indian cities by state (fallback when API fails)
export const INDIAN_CITIES: Record<string, string[]> = {
  'Maharashtra': ['Mumbai', 'Pune', 'Nagpur', 'Thane', 'Nashik', 'Aurangabad', 'Solapur', 'Kolhapur', 'Amravati', 'Nanded'],
  'Karnataka': ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru', 'Belagavi', 'Gulbarga', 'Davangere', 'Shivamogga'],
  'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore'],
  'Delhi': ['New Delhi', 'Noida', 'Gurgaon', 'Faridabad', 'Ghaziabad'],
  'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Agra', 'Varanasi', 'Meerut', 'Prayagraj', 'Bareilly', 'Aligarh'],
  'Gujarat': ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Junagadh', 'Gandhinagar'],
  'Rajasthan': ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner', 'Alwar', 'Bharatpur'],
  'West Bengal': ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Bardhaman', 'Kharagpur'],
  'Madhya Pradesh': ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Satna', 'Rewa'],
  'Telangana': ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Ramagundam', 'Khammam'],
  'Andhra Pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Tirupati', 'Rajahmundry'],
  'Kerala': ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Kollam', 'Thrissur', 'Alappuzha', 'Palakkad'],
  'Punjab': ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Hoshiarpur'],
  'Haryana': ['Faridabad', 'Gurgaon', 'Panipat', 'Ambala', 'Yamunanagar', 'Rohtak', 'Hisar', 'Karnal'],
  'Bihar': ['Patna', 'Gaya', 'Muzaffarpur', 'Bhagalpur', 'Darbhanga', 'Arrah', 'Begusarai'],
  'Odisha': ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri'],
  'Jharkhand': ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Deoghar', 'Hazaribagh'],
  'Chhattisgarh': ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg', 'Rajnandgaon'],
  'Assam': ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Nagaon', 'Tinsukia'],
  'Goa': ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda'],
  'Uttarakhand': ['Dehradun', 'Haridwar', 'Haldwani', 'Roorkee', 'Rishikesh', 'Kashipur'],
  'Himachal Pradesh': ['Shimla', 'Manali', 'Dharamshala', 'Kullu', 'Mandi', 'Solan'],
  'Jammu and Kashmir': ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla', 'Udhampur'],
  'Chandigarh': ['Chandigarh'],
  'Puducherry': ['Pondicherry', 'Karaikal', 'Mahe', 'Yanam'],
};

export const COUNTRIES_DATA = [
  { name: 'India', code: 'IN', phoneCode: '+91', phoneLength: 10 },
  { name: 'USA', code: 'US', phoneCode: '+1', phoneLength: 10 },
  { name: 'UK', code: 'GB', phoneCode: '+44', phoneLength: 10 },
  { name: 'UAE', code: 'AE', phoneCode: '+971', phoneLength: 9 },
  { name: 'Saudi Arabia', code: 'SA', phoneCode: '+966', phoneLength: 9 },
  { name: 'Qatar', code: 'QA', phoneCode: '+974', phoneLength: 8 },
  { name: 'Bahrain', code: 'BH', phoneCode: '+973', phoneLength: 8 },
  { name: 'Oman', code: 'OM', phoneCode: '+968', phoneLength: 8 },
  { name: 'Kuwait', code: 'KW', phoneCode: '+965', phoneLength: 8 },
  { name: 'Singapore', code: 'SG', phoneCode: '+65', phoneLength: 8 },
  { name: 'Malaysia', code: 'MY', phoneCode: '+60', phoneLength: 10 },
  { name: 'Thailand', code: 'TH', phoneCode: '+66', phoneLength: 9 },
  { name: 'China', code: 'CN', phoneCode: '+86', phoneLength: 11 },
  { name: 'Japan', code: 'JP', phoneCode: '+81', phoneLength: 10 },
  { name: 'South Korea', code: 'KR', phoneCode: '+82', phoneLength: 10 },
  { name: 'Australia', code: 'AU', phoneCode: '+61', phoneLength: 9 },
  { name: 'New Zealand', code: 'NZ', phoneCode: '+64', phoneLength: 9 },
  { name: 'South Africa', code: 'ZA', phoneCode: '+27', phoneLength: 9 },
  { name: 'Nigeria', code: 'NG', phoneCode: '+234', phoneLength: 10 },
  { name: 'Kenya', code: 'KE', phoneCode: '+254', phoneLength: 9 },
  { name: 'Pakistan', code: 'PK', phoneCode: '+92', phoneLength: 10 },
  { name: 'Bangladesh', code: 'BD', phoneCode: '+880', phoneLength: 10 },
  { name: 'Sri Lanka', code: 'LK', phoneCode: '+94', phoneLength: 9 },
  { name: 'Nepal', code: 'NP', phoneCode: '+977', phoneLength: 10 },
  { name: 'Germany', code: 'DE', phoneCode: '+49', phoneLength: 11 },
  { name: 'France', code: 'FR', phoneCode: '+33', phoneLength: 9 },
  { name: 'Canada', code: 'CA', phoneCode: '+1', phoneLength: 10 },
  { name: 'Brazil', code: 'BR', phoneCode: '+55', phoneLength: 11 },
];

// Fetch states for a country
export async function fetchStates(countryName: string): Promise<string[]> {
  // For India, return hardcoded list for reliability
  if (countryName === 'India') {
    return Object.keys(INDIAN_STATES).sort();
  }

  try {
    const res = await fetch('https://api.countriesnow.space/v0.0.1/countries/states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: countryName }),
    });
    const data = await res.json();
    if (data.data && data.data.states) {
      return data.data.states.map((s: any) => s.name).sort();
    }
  } catch {}
  return [];
}

// Fetch cities for a country and state
export async function fetchCities(countryName: string, stateName: string): Promise<string[]> {
  // For India, use hardcoded list first (more reliable)
  if (countryName === 'India' && INDIAN_CITIES[stateName]) {
    return INDIAN_CITIES[stateName];
  }

  // Try API for other countries or if not in hardcoded list
  try {
    const res = await fetch('https://api.countriesnow.space/v0.0.1/countries/state/cities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: countryName, state: stateName }),
    });
    const data = await res.json();
    if (data.data && data.data.length > 0) {
      return data.data.sort();
    }
  } catch {}

  // Fallback for India if API fails
  if (countryName === 'India' && INDIAN_CITIES[stateName]) {
    return INDIAN_CITIES[stateName];
  }

  return [];
}

// Get state code for Indian state
export function getStateCode(stateName: string): string {
  return INDIAN_STATES[stateName] || '';
}
