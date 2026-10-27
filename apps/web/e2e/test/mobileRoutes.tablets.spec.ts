// Every page on an iPad mini and an iPad Air, upright and on their side: it
// fits and has 44 px tap targets. See ../mobileRoutes.ts.
import { mobileRouteTests } from '../mobileRoutes';

mobileRouteTests((d) => /^tablet-ipad-(mini|air)(-landscape)?$/.test(d));
