import helmet from 'helmet';
import { isProduction } from '../config/env';

export const securityHeaders = helmet({
  strictTransportSecurity: isProduction,
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginResourcePolicy: { policy: 'same-site' },
});