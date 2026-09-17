import { MANDELBROT, MANDELBROT_FE } from './mandelbrot.js';
import { WEBB, WEBB_PERT, WEBB_FE } from './webb.js';
import { COLLATZ, COLLATZ_PERT } from './collatz.js';
import { JULIA, JULIA_PERT, JULIA_FE } from './julia.js';
import { BURNING_SHIP, SHIP_PERT, SHIP_FE } from './ship.js';
import { MANDELBUG, BUG_PERT, BUG_FE } from './mandelbug.js';
import { PACMAN_PERT } from './pacman.js';
import { OCTOPUS, OCTOPUS_PERT, OCTOPUS_FE } from './octopus.js';

export const SOURCES = {
  mandelbrot: MANDELBROT,
  mandelbrotFE: MANDELBROT_FE,
  webb: WEBB,
  webbPert: WEBB_PERT,
  webbFE: WEBB_FE,
  collatz: COLLATZ,
  collatzPert: COLLATZ_PERT,
  julia: JULIA,
  juliaPert: JULIA_PERT,
  juliaFE: JULIA_FE,
  ship: BURNING_SHIP,
  shipPert: SHIP_PERT,
  shipFE: SHIP_FE,
  bug: MANDELBUG,
  bugPert: BUG_PERT,
  bugFE: BUG_FE,
  pacman: PACMAN_PERT,
  octopus: OCTOPUS,
  octopusPert: OCTOPUS_PERT,
  octopusFE: OCTOPUS_FE,
};

export const SHADERS = {
  mandelbrot: { pert: 'mandelbrot', fe: 'mandelbrotFE' },
  webb: { float: 'webb', pert: 'webbPert', fe: 'webbFE' },
  collatz: { float: 'collatz', pert: 'collatzPert', fe: 'collatzPert' },
  julia: { float: 'julia', pert: 'juliaPert', fe: 'juliaFE' },
  burningship: { float: 'ship', pert: 'shipPert', fe: 'shipFE' },
  mandelbug: { float: 'bug', pert: 'bugPert', fe: 'bugFE' },
  pacman: { pert: 'pacman', fe: 'pacman' },
  octopus: { float: 'octopus', pert: 'octopusPert', fe: 'octopusFE' },
  custom: { float: 'custom' },
};

export const COST = {
  mandelbrot: 1, mandelbrotFE: 5,
  webb: 1, webbPert: 1.5, webbFE: 6,
  collatz: 1, collatzPert: 8,
  julia: 1, juliaPert: 1, juliaFE: 5,
  ship: 1.2, shipPert: 2, shipFE: 7,
  bug: 1, bugPert: 1, bugFE: 5,
  pacman: 1,
  octopus: 1.2, octopusPert: 2, octopusFE: 7,
  custom: 4,
};

