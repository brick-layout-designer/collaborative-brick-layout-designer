// Every page on an iPad Pro 12.9 and an Android tablet, upright and on their
// side, and in iPad split view: it fits and has 44 px tap targets. See
// ../mobileRoutes.ts.
import { mobileRouteTests } from '../mobileRoutes';

mobileRouteTests((d) => /^tablet-(ipad-pro-12|android|ipad-air-split)/.test(d));
