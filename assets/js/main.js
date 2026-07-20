/**
 * Steinbach Instruments — shared site behaviour
 * Loaded on every page: mobile nav toggle, the "Instruments" dropdown
 * (hover on desktop, tap on touch/mobile), a scrolled-state on the nav bar,
 * and the .reveal scroll-in animation used throughout the pages.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    initNav();
    initReveal();
  });

  function initNav() {
    var nav = document.getElementById('nav');
    var toggle = document.getElementById('nav-toggle');
    var links = nav && nav.querySelector('.nav-links');
    if (!nav || !toggle || !links) return;

    var scrim = document.createElement('div');
    scrim.className = 'nav-scrim';
    document.body.appendChild(scrim);

    function closeMenu() {
      toggle.classList.remove('is-open');
      links.classList.remove('is-open');
      scrim.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('nav-locked');
    }

    function openMenu() {
      toggle.classList.add('is-open');
      links.classList.add('is-open');
      scrim.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.classList.add('nav-locked');
    }

    toggle.addEventListener('click', function () {
      if (links.classList.contains('is-open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    scrim.addEventListener('click', closeMenu);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });

    // Dropdown: on touch/mobile the parent link toggles the submenu instead
    // of navigating straight through, since hover isn't available.
    var drop = nav.querySelector('.nav-item-drop');
    var dropLink = drop && drop.querySelector(':scope > a');
    if (drop && dropLink) {
      dropLink.addEventListener('click', function (e) {
        if (window.matchMedia('(max-width: 900px)').matches) {
          e.preventDefault();
          drop.classList.toggle('is-open');
        }
      });
    }

    links.addEventListener('click', function (e) {
      var link = e.target.closest('a');
      if (!link) return;
      if (link === dropLink && window.matchMedia('(max-width: 900px)').matches) return;
      closeMenu();
    });

    var lastScrolled = false;
    function onScroll() {
      var scrolled = window.scrollY > 40;
      if (scrolled !== lastScrolled) {
        nav.classList.toggle('is-scrolled', scrolled);
        lastScrolled = scrolled;
      }
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('in-view'); });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
    );

    items.forEach(function (el) { observer.observe(el); });
  }
})();
