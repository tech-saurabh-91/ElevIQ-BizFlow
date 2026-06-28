'use client';

import { useState, useEffect, useRef } from 'react';
import { COUNTRIES_DATA, getStateCode } from '@/utils/locationData';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

interface LocationSelectsProps {
  country: string;
  state: string;
  city: string;
  stateCode: string;
  onCountryChange: (val: string) => void;
  onStateChange: (val: string, stateCode: string) => void;
  onCityChange: (val: string) => void;
  showCity?: boolean;
  showStateCode?: boolean;
  required?: boolean;
}

export default function LocationSelects({
  country, state, city, stateCode,
  onCountryChange, onStateChange, onCityChange,
  showCity = true, showStateCode = true, required = false,
}: LocationSelectsProps) {
  const [states, setStates] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [loadingStates, setLoadingStates] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const prevCountryRef = useRef(country);
  const initializedRef = useRef(false);

  // Fetch states when country changes (not on initial mount if values are pre-filled)
  useEffect(() => {
    if (!country) {
      setStates([]);
      setCities([]);
      prevCountryRef.current = '';
      return;
    }

    const isFirstSetup = !initializedRef.current;
    initializedRef.current = true;

    // Only clear state/city when user ACTUALLY changes the country (not on initial mount)
    if (!isFirstSetup && prevCountryRef.current !== country) {
      onStateChange('', '');
      onCityChange('');
    }
    prevCountryRef.current = country;

    let cancelled = false;
    setLoadingStates(true);
    fetch(`${API_URL}/super-admin/cities/states?country=${encodeURIComponent(country)}`, {
      headers: { 'Content-Type': 'application/json' },
    })
      .then(res => res.json())
      .then(data => {
        if (!cancelled) {
          if (data.success && data.data) {
            setStates(data.data);
          } else {
            setStates([]);
          }
        }
      })
      .catch(() => { if (!cancelled) setStates([]); })
      .finally(() => { if (!cancelled) setLoadingStates(false); });

    return () => { cancelled = true; };
  }, [country]);

  // Fetch cities when state changes
  useEffect(() => {
    if (!country || !state) {
      setCities([]);
      return;
    }

    let cancelled = false;
    setLoadingCities(true);
    fetch(`${API_URL}/super-admin/cities?state=${encodeURIComponent(state)}&country=${encodeURIComponent(country)}`, {
      headers: { 'Content-Type': 'application/json' },
    })
      .then(res => res.json())
      .then(data => {
        if (!cancelled) {
          if (data.success && data.data) {
            setCities(data.data.map((c: any) => c.cityName).sort());
          } else {
            setCities([]);
          }
        }
      })
      .catch(() => { if (!cancelled) setCities([]); })
      .finally(() => { if (!cancelled) setLoadingCities(false); });

    return () => { cancelled = true; };
  }, [country, state]);

  const handleCountry = (val: string) => {
    onCountryChange(val);
  };

  const handleState = (val: string) => {
    const code = getStateCode(val);
    onStateChange(val, code);
  };

  const labelClass = 'block text-sm font-medium text-gray-700 mb-1';
  const selectClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white';

  const stateOptions = state && !states.includes(state) ? [state, ...states] : states;
  const cityOptions = city && !cities.includes(city) ? [city, ...cities] : cities;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Country */}
      <div>
        <label className={labelClass}>Country {required && <span className="text-red-500">*</span>}</label>
        <select value={country} onChange={(e) => handleCountry(e.target.value)} className={selectClass} required={required}>
          <option value="">Select Country</option>
          {COUNTRIES_DATA.map(c => <option key={c.code} value={c.name}>{c.name}</option>)}
        </select>
      </div>

      {/* State */}
      <div>
        <label className={labelClass}>State {required && <span className="text-red-500">*</span>}</label>
        <select value={state} onChange={(e) => handleState(e.target.value)} className={selectClass} required={required} disabled={!country || loadingStates}>
          <option value="">{loadingStates ? 'Loading...' : 'Select State'}</option>
          {stateOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* City */}
      {showCity && (
        <div>
          <label className={labelClass}>City {required && <span className="text-red-500">*</span>}</label>
          {loadingCities ? (
            <select className={selectClass} disabled>
              <option value="">Loading cities...</option>
            </select>
          ) : cityOptions.length > 0 ? (
            <select value={city} onChange={(e) => onCityChange(e.target.value)} className={selectClass} required={required} disabled={!state}>
              <option value="">Select City</option>
              {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <input type="text" value={city} onChange={(e) => onCityChange(e.target.value)}
              placeholder="Enter city" className={selectClass} required={required} />
          )}
        </div>
      )}

      {/* State Code (Indian states only) */}
      {showStateCode && country === 'India' && stateCode && (
        <div>
          <label className={labelClass}>GST State Code</label>
          <input type="text" value={stateCode} readOnly className={`${selectClass} bg-gray-50`} />
        </div>
      )}
    </div>
  );
}
