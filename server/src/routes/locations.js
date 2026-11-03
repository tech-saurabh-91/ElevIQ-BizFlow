import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/locationController.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { authorize } from '../middlewares/rbac.js';
import { TAX_REGIMES } from '../models/Country.js';

const countryCode = z.string().trim().regex(/^[A-Za-z]{2}$/, 'Use the 2-letter ISO country code');
const name = z.string().trim().min(1).max(120);

const taxSchema = z
  .object({
    regime: z.enum(TAX_REGIMES),
    label: z.string().trim().min(1).max(30),
    taxIdLabel: z.string().trim().min(1).max(30),
    defaultRate: z.coerce.number().min(0).max(100),
    maxRate: z.coerce.number().min(0).max(100),
    splitIntraState: z.boolean(),
  })
  .partial();

const postalSchema = z
  .object({
    label: z.string().trim().min(1).max(30),
    numeric: z.boolean(),
    length: z.coerce.number().int().min(1).max(12).nullable(),
    pattern: z
      .string()
      .max(120)
      .refine((p) => {
        try {
          new RegExp(p);
          return true;
        } catch {
          return false;
        }
      }, 'Invalid regular expression'),
  })
  .partial();

const countryBody = z.object({
  name,
  flag: z.string().max(8).optional(),
  phoneCode: z.string().max(8).optional(),
  currency: z.string().trim().toUpperCase().max(3).optional(),
  currencySymbol: z.string().max(6).optional(),
  timezones: z.array(z.string().max(60)).max(50).optional(),
  locale: z.string().max(20).optional(),
  tax: taxSchema.optional(),
  postalCode: postalSchema.optional(),
  isActive: z.boolean().optional(),
});

const stateBody = z.object({ code: z.string().trim().min(1).max(10), name });
const cityBody = z.object({ name });
const toggleBody = z.object({ name: name.optional(), isActive: z.boolean().optional() });

/** /api/locations - read-only, any signed-in user (address pickers). */
export const locationReadRoutes = Router();
locationReadRoutes.use(authenticate);
locationReadRoutes.get('/countries', ctrl.listCountries);
locationReadRoutes.get('/countries/:code', ctrl.getCountry);
locationReadRoutes.get('/countries/:code/states', ctrl.listStates);
locationReadRoutes.get('/countries/:code/states/:state/cities', ctrl.listCities);

/** /api/platform/locations - platform admin maintenance (support is read-only). */
export const locationAdminRoutes = Router();
locationAdminRoutes.use(authorize());
locationAdminRoutes.get('/countries', ctrl.listCountries);
locationAdminRoutes.post('/countries', validate({ body: countryBody.extend({ code: countryCode }) }), ctrl.createCountry);
locationAdminRoutes.patch('/countries/:code', validate({ body: countryBody.partial() }), ctrl.updateCountry);
locationAdminRoutes.get('/countries/:code/states', ctrl.listStates);
locationAdminRoutes.post('/countries/:code/states', validate({ body: stateBody }), ctrl.createState);
locationAdminRoutes.patch('/countries/:code/states/:id', validate({ body: toggleBody }), ctrl.updateState);
locationAdminRoutes.get('/countries/:code/states/:state/cities', ctrl.listCities);
locationAdminRoutes.post('/countries/:code/states/:state/cities', validate({ body: cityBody }), ctrl.createCity);
locationAdminRoutes.patch('/countries/:code/cities/:id', validate({ body: toggleBody }), ctrl.updateCity);
locationAdminRoutes.post('/countries/:code/import-cities', ctrl.importCountryCities);

export default locationReadRoutes;
