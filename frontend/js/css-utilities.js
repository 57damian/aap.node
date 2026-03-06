/**
 * UTILIDADES CSS PARA MANTENIMIENTO UNIFICADO
 * Este archivo contiene funciones para gestionar estilos dinámicamente
 */

class CSSUtilities {
  constructor() {
    this.init();
  }

  init() {
    // Inicializar tooltips
    this.initTooltips();
    
    // Inicializar animaciones de entrada
    this.initAnimations();
    
    // Inicializar validación de formularios
    this.initFormValidation();
    
    // Inicializar lazy loading de imágenes
    this.initLazyLoading();
  }

  // ===== TOOLTIPS =====
  initTooltips() {
    document.addEventListener('mouseover', (e) => {
      const tooltip = e.target.closest('[data-tooltip]');
      if (tooltip) {
        this.showTooltip(tooltip);
      }
    });

    document.addEventListener('mouseout', (e) => {
      const tooltip = e.target.closest('[data-tooltip]');
      if (tooltip) {
        this.hideTooltip(tooltip);
      }
    });
  }

  showTooltip(element) {
    const text = element.getAttribute('data-tooltip');
    const tooltipEl = document.createElement('div');
    tooltipEl.className = 'tooltip-modern';
    tooltipEl.innerHTML = `
      <div class="tooltip-content">${text}</div>
    `;
    element.appendChild(tooltipEl);
    
    setTimeout(() => {
      tooltipEl.classList.add('show');
    }, 10);
  }

  hideTooltip(element) {
    const tooltip = element.querySelector('.tooltip-modern');
    if (tooltip) {
      tooltip.remove();
    }
  }

  // ===== ANIMACIONES =====
  initAnimations() {
    // Observer para animaciones de entrada
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('fade-in');
        }
      });
    }, {
      threshold: 0.1
    });

    // Observar elementos con animación
    document.querySelectorAll('[data-animate]').forEach(el => {
      observer.observe(el);
    });
  }

  // ===== VALIDACIÓN DE FORMULARIOS =====
  initFormValidation() {
    document.addEventListener('input', (e) => {
      this.validateField(e.target);
    });

    document.addEventListener('blur', (e) => {
      this.validateField(e.target);
    });
  }

  validateField(field) {
    const isValid = this.checkFieldValidity(field);
    
    // Remover clases previas
    field.classList.remove('is-valid', 'is-invalid');
    
    // Agregar clase correspondiente
    if (field.value.length > 0) {
      field.classList.add(isValid ? 'is-valid' : 'is-invalid');
    }

    // Mostrar mensaje de error
    this.showFieldError(field, isValid);
  }

  checkFieldValidity(field) {
    const type = field.type;
    const value = field.value.trim();
    const required = field.hasAttribute('required');

    // Campos requeridos vacíos
    if (required && !value) {
      return false;
    }

    // Validaciones específicas por tipo
    switch (type) {
      case 'email':
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      
      case 'tel':
        return /^[\d\s\-\+\(\)]+$/.test(value) && value.replace(/\D/g, '').length >= 8;
      
      case 'number':
        return !isNaN(value) && parseFloat(value) >= 0;
      
      default:
        return value.length > 0;
    }
  }

  showFieldError(field, isValid) {
    // Buscar o crear elemento de error
    let errorEl = field.parentNode.querySelector('.form-text.error');
    
    if (!isValid && field.value.length > 0) {
      if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.className = 'form-text error';
        field.parentNode.appendChild(errorEl);
      }
      
      // Mensaje de error según tipo
      const type = field.type;
      const name = field.name || field.id;
      
      let message = '';
      switch (type) {
        case 'email':
          message = 'Ingrese un email válido';
          break;
        case 'tel':
          message = 'Ingrese un teléfono válido';
          break;
        case 'number':
          message = 'Ingrese un número válido';
          break;
        default:
          message = 'Este campo es requerido';
      }
      
      errorEl.textContent = message;
    } else if (errorEl) {
      errorEl.remove();
    }
  }

  // ===== LAZY LOADING =====
  initLazyLoading() {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          img.classList.remove('lazy');
          imageObserver.unobserve(img);
        }
      });
    });

    document.querySelectorAll('img[data-src]').forEach(img => {
      img.classList.add('lazy');
      imageObserver.observe(img);
    });
  }

  // ===== UTILIDADES DE CLASES =====
  addClass(element, className) {
    if (element) {
      element.classList.add(className);
    }
  }

  removeClass(element, className) {
    if (element) {
      element.classList.remove(className);
    }
  }

  toggleClass(element, className) {
    if (element) {
      element.classList.toggle(className);
    }
  }

  hasClass(element, className) {
    return element ? element.classList.contains(className) : false;
  }

  // ===== UTILIDADES DE ESTILOS =====
  showElement(element) {
    if (element) {
      element.style.display = '';
      this.addClass(element, 'fade-in');
    }
  }

  hideElement(element) {
    if (element) {
      element.style.display = 'none';
    }
  }

  enableButton(button) {
    if (button) {
      button.disabled = false;
      this.removeClass(button, 'btn-loading');
    }
  }

  disableButton(button) {
    if (button) {
      button.disabled = true;
      this.addClass(button, 'btn-loading');
    }
  }

  // ===== NOTIFICACIONES =====
  showNotification(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} fade-in`;
    notification.innerHTML = `
      <div class="d-flex align-items-center gap-2">
        <i class="fas ${this.getNotificationIcon(type)}"></i>
        <span>${message}</span>
        <button type="button" class="btn-close ms-auto" onclick="this.parentElement.parentElement.remove()"></button>
      </div>
    `;

    // Contenedor de notificaciones
    let container = document.getElementById('notifications-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notifications-container';
      container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        max-width: 400px;
      `;
      document.body.appendChild(container);
    }

    container.appendChild(notification);

    // Auto eliminar
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, duration);
  }

  getNotificationIcon(type) {
    const icons = {
      success: 'fa-check-circle',
      warning: 'fa-exclamation-triangle',
      danger: 'fa-times-circle',
      info: 'fa-info-circle'
    };
    return icons[type] || icons.info;
  }

  // ===== LOADER =====
  showLoader(message = 'Cargando...') {
    const loader = document.createElement('div');
    loader.className = 'loader-overlay';
    loader.innerHTML = `
      <div class="loader-content">
        <div class="spinner-modern"></div>
        <div class="loader-text">${message}</div>
      </div>
    `;
    document.body.appendChild(loader);
  }

  hideLoader() {
    const loader = document.querySelector('.loader-overlay');
    if (loader) {
      loader.remove();
    }
  }

  // ===== UTILIDADES DE TABLAS =====
  highlightTableRow(row, className = 'selected') {
    // Remover selección previa
    document.querySelectorAll(`.${className}`).forEach(el => {
      el.classList.remove(className);
    });
    
    // Agregar selección actual
    if (row) {
      row.classList.add(className);
    }
  }

  // ===== UTILIDADES DE FORMULARIOS =====
  resetForm(form) {
    if (form) {
      form.reset();
      
      // Remover clases de validación
      form.querySelectorAll('.is-valid, .is-invalid').forEach(field => {
        field.classList.remove('is-valid', 'is-invalid');
      });
      
      // Remover mensajes de error
      form.querySelectorAll('.form-text.error').forEach(error => {
        error.remove();
      });
    }
  }

  serializeForm(form) {
    const formData = new FormData(form);
    const data = {};
    
    for (let [key, value] of formData.entries()) {
      data[key] = value;
    }
    
    return data;
  }

  // ===== UTILIDADES DE NÚMEROS =====
  formatCurrency(amount, currency = 'ARS') {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: currency
    }).format(amount);
  }

  formatNumber(number) {
    return new Intl.NumberFormat('es-AR').format(number);
  }

  // ===== UTILIDADES DE FECHAS =====
  formatDate(date, format = 'DD/MM/YYYY') {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    
    return format
      .replace('DD', day)
      .replace('MM', month)
      .replace('YYYY', year);
  }

  // ===== UTILIDADES DE STORAGE =====
  setStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Error guardando en localStorage:', e);
    }
  }

  getStorage(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
      console.error('Error leyendo localStorage:', e);
      return defaultValue;
    }
  }

  removeStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error('Error eliminando de localStorage:', e);
    }
  }

  // ===== UTILIDADES DE RESPONSIVE =====
  isMobile() {
    return window.innerWidth <= 768;
  }

  isTablet() {
    return window.innerWidth > 768 && window.innerWidth <= 1024;
  }

  isDesktop() {
    return window.innerWidth > 1024;
  }

  // ===== DEBOUNCE =====
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // ===== THROTTLE =====
  throttle(func, limit) {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
}

// Inicializar utilidades globales
window.cssUtils = new CSSUtilities();

// Compatibilidad: API minima esperada en otras pantallas
if (typeof window.cssUtils.formatCurrency !== 'function') {
  window.cssUtils.formatCurrency = function(amount) {
    return '$' + parseFloat(amount || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
  };
}

if (typeof window.cssUtils.showNotification !== 'function') {
  window.cssUtils.showNotification = function(message) {
    alert(message);
  };
}

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CSSUtilities;
}
