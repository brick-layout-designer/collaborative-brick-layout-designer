// Every page on a phone, upright and on its side (360×740, iPhone 14,
// Pixel 7): it fits and has 44 px tap targets. See ../mobileRoutes.ts.
import { mobileRouteTests } from '../mobileRoutes';

mobileRouteTests((d) => /^(360x740|iphone14|pixel7)/.test(d));
