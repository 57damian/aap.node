// facturas-compra.js - Versión corregida
// Sistema de gestión de facturas de compra con ítems editables

class FacturasCompra {
    constructor() {
        this.items = [];
        this.proveedores = [];
        this.materiasPrimas = [];
        this.currentItemId = 1;
        this.isEditing = false;
        this.currentFacturaId = null;
        
        // Nuevo campo para rastrear precios editados
        this.preciosEditados = new Set();
        
        // Marca de versión para depuración en navegador
        console.log('✅ FacturasCompra JS cargado - versión campos MP v2');
        
        this.init();
    }
    
    async init() {
        // Cargar datos en paralelo usando Promise.allSettled para manejar errores
        const results = await Promise.allSettled([
            this.loadProveedores(),
            this.loadMateriasPrimas()
        ]);
        
        // Procesar resultados
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.error(`Error en carga ${index === 0 ? 'proveedores' : 'materias primas'}:`, result.reason);
            }
        });
        
        this.setupEventListeners();
        this.setupDateDefaults();
        this.renderItemsTable();
        this.calculateTotals();
        
        // Cargar Select2 para proveedores
        if ($ && $.fn.select2) {
            $('#proveedor').select2({
                placeholder: 'Seleccionar proveedor...',
                allowClear: true,
                width: '100%'
            }).on('change', this.onProveedorChange.bind(this));
        }
        
        // Agregar fila inicial - SIEMPRE se debe llamar
        this.addEmptyItem();
    }
    
    async loadProveedores() {
        try {
            // Mostrar indicador de carga
            this.showAlert('Cargando proveedores...', 'info');
            
            // Usar apiFetch si está disponible, sino usar fetch con API_URL
            if (typeof apiFetch === 'function') {
                this.proveedores = await apiFetch('/api/proveedores');
            } else {
                const response = await fetch(`${API_URL || 'http://localhost:3000'}/api/proveedores`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    }
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Error ${response.status}: ${errorText}`);
                }
                
                this.proveedores = await response.json();
            }
            
            if (!Array.isArray(this.proveedores)) {
                throw new Error('Formato de datos inválido para proveedores');
            }
            
            this.populateProveedoresSelect();
            
            // Ocultar alerta de carga
            setTimeout(() => {
                const alerts = document.querySelectorAll('#alert-container .alert');
                alerts.forEach(alert => {
                    if (alert.textContent.includes('Cargando proveedores')) {
                        alert.remove();
                    }
                });
            }, 500);
            
        } catch (error) {
            console.error('Error cargando proveedores:', error);
            this.showAlert(`Error cargando proveedores: ${error.message}`, 'danger');
            // Inicializar array vacío para evitar errores
            this.proveedores = [];
            this.populateProveedoresSelect();
        }
    }
    
    async loadMateriasPrimas() {
        try {
            // Mostrar indicador de carga
            this.showAlert('Cargando materias primas del stock...', 'info');
            
            // Usar apiFetch si está disponible, sino usar fetch con API_URL
            if (typeof apiFetch === 'function') {
                this.materiasPrimas = await apiFetch('/api/materias-primas');
            } else {
                const response = await fetch(`${API_URL || 'http://localhost:3000'}/api/materias-primas`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    }
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Error ${response.status}: ${errorText}`);
                }
                
                this.materiasPrimas = await response.json();
            }
            
            if (!Array.isArray(this.materiasPrimas)) {
                throw new Error('Formato de datos inválido para materias primas');
            }
            
            // Filtrar solo materias primas activas o con stock
            this.materiasPrimas = this.materiasPrimas.filter(mp => 
                mp.estado === 'ACTIVO' || mp.estado === 'activo' || mp.stock_actual > 0
            );
            
            // Ordenar por nombre
            this.materiasPrimas.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
            
            // Ocultar alerta de carga
            setTimeout(() => {
                const alerts = document.querySelectorAll('#alert-container .alert');
                alerts.forEach(alert => {
                    if (alert.textContent.includes('Cargando materias primas')) {
                        alert.remove();
                    }
                });
            }, 500);
            
            this.showAlert(`Cargadas ${this.materiasPrimas.length} materias primas del stock`, 'success');
            
            // Si no hay materias primas, mostrar alerta informativa
            if (this.materiasPrimas.length === 0) {
                this.showAlert('No se encontraron materias primas en el stock. Puede agregar ítems manualmente.', 'warning');
            }
            
            // Actualizar los selects existentes inmediatamente después de cargar
            this.updateAllItemSelects();
            
            // Log para depuración
            console.log('✅ Materias primas cargadas:', this.materiasPrimas.length);
            console.log('📋 Lista de materias primas:', this.materiasPrimas.map(mp => ({
                id: mp.id,
                codigo: mp.codigo,
                nombre: mp.nombre,
                unidad: mp.unidad_medida,
                precio: mp.ultimo_precio
            })));
            
        } catch (error) {
            console.error('Error cargando materias primas:', error);
            this.showAlert(`Error cargando materias primas: ${error.message}`, 'danger');
            // Inicializar array vacío para evitar errores
            this.materiasPrimas = [];
            this.showAlert('Usando modo manual para ítems. Puede agregar productos manualmente.', 'warning');
        }
    }
    
    // Método para forzar la recarga de materias primas
    async reloadMateriasPrimas() {
        try {
            this.showAlert('Recargando materias primas del stock...', 'info');
            await this.loadMateriasPrimas();
            
            // Actualizar los selects existentes
            this.updateAllItemSelects();
            
        } catch (error) {
            console.error('Error recargando materias primas:', error);
            this.showAlert('Error recargando materias primas', 'danger');
        }
    }
    
    // Actualizar todos los selects de ítems con las nuevas materias primas
    updateAllItemSelects() {
        const selects = document.querySelectorAll('.item-select');
        selects.forEach((select, index) => {
            // Guardar el valor actual
            const currentValue = select.value;
            
            // Limpiar opciones excepto las primeras dos (vacía y manual)
            while (select.options.length > 2) {
                select.remove(2);
            }
            
            // Agregar nuevas materias primas
            this.materiasPrimas.forEach(mp => {
                const option = document.createElement('option');
                option.value = mp.id;
                option.textContent = `${mp.codigo || 'Sin código'} - ${mp.nombre}`;
                option.dataset.codigo = mp.codigo || '';
                option.dataset.nombre = mp.nombre || '';
                option.dataset.unidad = mp.unidad_medida || 'UNI';
                option.dataset.precio = mp.ultimo_precio || 0;
                select.appendChild(option);
            });
            
            // Restaurar valor si aún existe
            if (currentValue && select.querySelector(`option[value="${currentValue}"]`)) {
                select.value = currentValue;
            } else if (currentValue === 'manual') {
                select.value = 'manual';
            } else {
                select.value = '';
            }
        });
    }
    
    populateProveedoresSelect() {
        const select = document.getElementById('proveedor');
        select.innerHTML = '<option value="">Seleccionar proveedor...</option>';
        
        this.proveedores.forEach(proveedor => {
            const option = document.createElement('option');
            option.value = proveedor.id;
            option.textContent = `${proveedor.nombre} - ${proveedor.cuit}`;
            select.appendChild(option);
        });
    }
    
    onProveedorChange(event) {
        const proveedorId = event.target.value;
        const proveedor = this.proveedores.find(p => p.id == proveedorId);
        
        if (proveedor) {
            document.getElementById('cuit').textContent = proveedor.cuit || '-';
            document.getElementById('telefono').textContent = proveedor.telefono || '-';
            document.getElementById('direccion').textContent = proveedor.direccion || '-';
        } else {
            document.getElementById('cuit').textContent = '-';
            document.getElementById('telefono').textContent = '-';
            document.getElementById('direccion').textContent = '-';
        }
    }
    
    setupDateDefaults() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('fecha_emision').value = today;
        document.getElementById('fecha_recepcion').value = today;
    }
    
    setupEventListeners() {
        // Botón agregar ítem
        document.getElementById('agregar-fila').addEventListener('click', () => {
            this.addEmptyItem();
        });
        
        // Botón guardar factura
        document.getElementById('btn-guardar-factura').addEventListener('click', () => {
            this.saveFactura();
        });
        
        // Botón limpiar
        document.getElementById('btn-limpiar').addEventListener('click', () => {
            this.clearForm();
        });
        
        // Actualizar número de factura en tiempo real
        document.getElementById('punto_venta').addEventListener('input', () => {
            this.updateNumeroFacturaDisplay();
        });
        
        document.getElementById('numero_factura').addEventListener('input', () => {
            this.updateNumeroFacturaDisplay();
        });
        
        // Botón para generar siguiente número
        document.getElementById('btn-siguiente-numero').addEventListener('click', () => {
            this.generateNextInvoiceNumber();
        });
        
        // Botón para copiar número
        document.getElementById('btn-copiar-numero').addEventListener('click', () => {
            this.copyInvoiceNumber();
        });
        
        // Botón para calcular subtotal automáticamente (verificar si existe)
        const btnCalcularSubtotal = document.getElementById('btn-calcular-subtotal');
        if (btnCalcularSubtotal) {
            btnCalcularSubtotal.addEventListener('click', () => {
                this.calculateSubtotal();
            });
        }
        
        // Botón para calcular IVA automáticamente (verificar si existe)
        const btnCalcularIva = document.getElementById('btn-calcular-iva');
        if (btnCalcularIva) {
            btnCalcularIva.addEventListener('click', () => {
                this.calculateIVA();
            });
        }
        
        // Percepciones y retenciones
        document.getElementById('percepciones').addEventListener('input', () => {
            this.calculateTotals();
        });
        
        document.getElementById('retenciones').addEventListener('input', () => {
            this.calculateTotals();
        });
        
        // Nuevos botones
        document.getElementById('btn-recargar-materias-primas').addEventListener('click', () => {
            this.reloadMateriasPrimas();
        });
        
        document.getElementById('btn-agregar-multiple').addEventListener('click', () => {
            this.addMultipleItems(5);
        });
        
        document.getElementById('btn-validar-items').addEventListener('click', () => {
            this.validateAllItems();
        });
    }
    
    addEmptyItem() {
        const item = {
            id: this.currentItemId++,
            materia_prima_id: null,
            codigo: '',
            nombre: '',
            unidad_medida: 'UNI',
            cantidad: 1,
            precio_unitario: 0,
            iva_porcentaje: 21,
            subtotal: 0,
            iva: 0,
            total: 0,
            actualizar_precio_referencia: false  // Nuevo campo para marcar si el precio fue editado
        };
        
        this.items.push(item);
        this.renderItemsTable();
        this.calculateTotals();
    }
    
    renderItemsTable() {
        const tbody = document.getElementById('items-body');
        tbody.innerHTML = '';
        
        this.items.forEach((item, index) => {
            const row = document.createElement('tr');
            row.className = 'item-row';
            row.dataset.index = index;
            
            // Columna 1: Select de producto
            const td1 = document.createElement('td');
            const select = document.createElement('select');
            select.className = 'form-control item-select';
            select.dataset.index = index;
            
            const opVacia = document.createElement('option');
            opVacia.value = '';
            opVacia.textContent = '-- Seleccionar materia prima --';
            select.appendChild(opVacia);
            
            // Agregar opción para ítem manual
            const opManual = document.createElement('option');
            opManual.value = 'manual';
            opManual.textContent = '-- Ítem manual --';
            select.appendChild(opManual);
            
            // Agregar materias primas del stock
            this.materiasPrimas.forEach(mp => {
                const option = document.createElement('option');
                option.value = mp.id;
                option.textContent = `${mp.codigo || 'Sin código'} - ${mp.nombre}`;
                option.dataset.codigo = mp.codigo || '';
                option.dataset.nombre = mp.nombre || '';
                option.dataset.unidad = mp.unidad_medida || 'UNI';
                option.dataset.precio = mp.ultimo_precio || 0;
                select.appendChild(option);
            });
            
            // Seleccionar opción correcta
            if (item.materia_prima_id) {
                select.value = item.materia_prima_id;
            } else if (item.es_item_manual) {
                select.value = 'manual';
            } else {
                select.value = '';
            }
            // Tooltip con el texto completo de la opción seleccionada
            if (select.selectedIndex >= 0) {
                select.title = select.options[select.selectedIndex].textContent;
            }
            
            select.addEventListener('change', (e) => this.onItemSelectChange(e, index));
            td1.appendChild(select);
            row.appendChild(td1);
            
            // Columna 2: Nombre (editable)
            const td2 = document.createElement('td');
            const inputNombre = document.createElement('input');
            inputNombre.type = 'text';
            inputNombre.className = 'form-control item-nombre';
            inputNombre.value = item.nombre || '';
            inputNombre.dataset.index = index;
            // El nombre ahora es editable manualmente
            inputNombre.readOnly = false;
            inputNombre.title = item.nombre || '';
            inputNombre.addEventListener('input', (e) => this.onItemFieldChange(e, index, 'nombre'));
            td2.appendChild(inputNombre);
            row.appendChild(td2);
            
            // Columna 3: Unidad (editable)
            const td3 = document.createElement('td');
            const inputUnidad = document.createElement('input');
            inputUnidad.type = 'text';
            inputUnidad.className = 'form-control item-unidad';
            inputUnidad.value = item.unidad_medida || 'UNI';
            inputUnidad.dataset.index = index;
            inputUnidad.title = item.unidad_medida || 'UNI';
            inputUnidad.addEventListener('input', (e) => this.onItemFieldChange(e, index, 'unidad_medida'));
            td3.appendChild(inputUnidad);
            row.appendChild(td3);
            
            // Columna 4: Cantidad (editable)
            const td4 = document.createElement('td');
            const inputCantidad = document.createElement('input');
            inputCantidad.type = 'number';
            inputCantidad.className = 'form-control item-cantidad';
            inputCantidad.value = item.cantidad;
            inputCantidad.min = 0.001;
            inputCantidad.step = 0.001;
            inputCantidad.dataset.index = index;
            inputCantidad.addEventListener('input', (e) => this.onItemFieldChange(e, index, 'cantidad'));
            td4.appendChild(inputCantidad);
            row.appendChild(td4);
            
            // Columna 5: Precio unitario (editable)
            const td5 = document.createElement('td');
            const inputPrecio = document.createElement('input');
            inputPrecio.type = 'number';
            inputPrecio.className = 'form-control item-precio';
            inputPrecio.value = item.precio_unitario;
            inputPrecio.min = 0;
            inputPrecio.step = 0.01;
            inputPrecio.dataset.index = index;
            inputPrecio.addEventListener('input', (e) => this.onItemFieldChange(e, index, 'precio_unitario'));
            td5.appendChild(inputPrecio);
            row.appendChild(td5);
            
            // Columna 6: IVA % (editable)
            const td6 = document.createElement('td');
            const inputIva = document.createElement('input');
            inputIva.type = 'number';
            inputIva.className = 'form-control item-iva';
            inputIva.value = item.iva_porcentaje;
            inputIva.min = 0;
            inputIva.max = 100;
            inputIva.step = 0.01;
            inputIva.dataset.index = index;
            inputIva.addEventListener('input', (e) => this.onItemFieldChange(e, index, 'iva_porcentaje'));
            td6.appendChild(inputIva);
            row.appendChild(td6);
            
            // Columna 7: Subtotal (solo lectura)
            const td7 = document.createElement('td');
            td7.className = 'item-subtotal';
            td7.textContent = `$${item.subtotal.toFixed(2)}`;
            row.appendChild(td7);
            
            // Columna 8: IVA (solo lectura)
            const td8 = document.createElement('td');
            td8.className = 'item-iva-calculo';
            td8.textContent = `$${item.iva.toFixed(2)}`;
            row.appendChild(td8);
            
            // Columna 9: Total (solo lectura)
            const td9 = document.createElement('td');
            td9.className = 'item-total';
            td9.textContent = `$${item.total.toFixed(2)}`;
            row.appendChild(td9);
            
            // Columna 10: Botón eliminar
            const td10 = document.createElement('td');
            const btnEliminar = document.createElement('button');
            btnEliminar.className = 'btn-eliminar-item';
            btnEliminar.innerHTML = '<i class="fas fa-trash"></i>';
            btnEliminar.addEventListener('click', () => {
                if (this.items.length > 1) {
                    this.items.splice(index, 1);
                    this.renderItemsTable();
                    this.calculateTotals();
                } else {
                    this.showAlert('Debe haber al menos un ítem', 'warning');
                }
            });
            td10.appendChild(btnEliminar);
            row.appendChild(td10);
            
            tbody.appendChild(row);
        });
    }
    
    onItemSelectChange(event, index) {
        const select = event.target;
        const row = select.closest('tr');
        if (!row) {
            console.error('No se pudo encontrar la fila del select');
            return;
        }
        
        // Obtener el índice de la fila usando el dataset
        const rowIndex = parseInt(select.dataset.index) || index;
        const item = this.items[rowIndex];
        
        if (!item) {
            console.error('No se encontró el ítem en el índice:', rowIndex);
            return;
        }
        
        if (select.value === 'manual') {
            // Ítem manual
            item.materia_prima_id = null;
            item.codigo = '';
            item.nombre = '';
            item.unidad_medida = 'UNI';
            item.precio_unitario = 0;
            item.actualizar_precio_referencia = false;
        } else if (select.value) {
            // Materia prima seleccionada
            const option = select.options[select.selectedIndex];
            const optionText = option ? (option.textContent || '') : '';
            const parts = optionText.split(' - ');
            const codigoTexto = parts.length > 1 ? parts[0] : '';
            const nombreTexto = parts.length > 1 ? parts[1] : optionText;
            item.materia_prima_id = parseInt(select.value);
            item.codigo = option.dataset.codigo || codigoTexto || '';
            item.nombre = option.dataset.nombre || nombreTexto || '';
            item.unidad_medida = option.dataset.unidad || item.unidad_medida || 'UNI';
            item.precio_unitario = parseFloat(option.dataset.precio) || 0;
            item.actualizar_precio_referencia = false; // Inicialmente no se actualiza el precio
        } else {
            // Vacío
            item.materia_prima_id = null;
            item.codigo = '';
            item.nombre = '';
            item.unidad_medida = 'UNI';
            item.precio_unitario = 0;
            item.actualizar_precio_referencia = false;
        }
        
        // Actualizar campos en la fila usando closest
        const nombreInput = row.querySelector('.item-nombre');
        const unidadInput = row.querySelector('.item-unidad');
        const precioInput = row.querySelector('.item-precio');
        
        if (nombreInput) {
            nombreInput.value = item.nombre;
            nombreInput.title = item.nombre || '';
        }
        if (unidadInput) {
            unidadInput.value = item.unidad_medida;
            unidadInput.title = item.unidad_medida || 'UNI';
        }
        if (precioInput) precioInput.value = item.precio_unitario;
        
        this.calculateItemTotals(rowIndex);
        this.calculateTotals();
    }
    
    onItemFieldChange(event, index, field) {
        const value = event.target.value;
        const item = this.items[index];
        
        if (field === 'nombre') {
            item.nombre = value;
        } else if (field === 'unidad_medida') {
            item.unidad_medida = value;
        } else if (field === 'cantidad') {
            item.cantidad = parseFloat(value) || 0;
        } else if (field === 'precio_unitario') {
            const nuevoPrecio = parseFloat(value) || 0;
            const precioOriginal = this.getPrecioOriginal(item.materia_prima_id);
            
            // Si el usuario edita el precio y hay una materia prima seleccionada,
            // marcar para actualizar el precio de referencia
            if (item.materia_prima_id && nuevoPrecio !== precioOriginal) {
                item.actualizar_precio_referencia = true;
            } else {
                item.actualizar_precio_referencia = false;
            }
            
            item.precio_unitario = nuevoPrecio;
        } else if (field === 'iva_porcentaje') {
            item.iva_porcentaje = parseFloat(value) || 0;
        }
        
        this.calculateItemTotals(index);
        this.calculateTotals();
    }
    
    calculateItemTotals(index) {
        const item = this.items[index];
        item.subtotal = item.cantidad * item.precio_unitario;
        item.iva = item.subtotal * (item.iva_porcentaje / 100);
        item.total = item.subtotal + item.iva;

        // Actualizar display en la fila utilizando data-index para evitar desfasajes
        const row = document.querySelector(`.item-row[data-index="${index}"]`);
        if (row) {
            const subtotalCell = row.querySelector('.item-subtotal');
            const ivaCell = row.querySelector('.item-iva-calculo');
            const totalCell = row.querySelector('.item-total');
            if (subtotalCell) subtotalCell.textContent = `$${item.subtotal.toFixed(2)}`;
            if (ivaCell) ivaCell.textContent = `$${item.iva.toFixed(2)}`;
            if (totalCell) totalCell.textContent = `$${item.total.toFixed(2)}`;
        }
    }
    
    calculateTotals() {
        let subtotal = 0;
        let iva = 0;
        let total = 0;
        
        this.items.forEach(item => {
            subtotal += item.subtotal;
            iva += item.iva;
            total += item.total;
        });
        
        // Agregar percepciones y restar retenciones
        const percepciones = parseFloat(document.getElementById('percepciones').value) || 0;
        const retenciones = parseFloat(document.getElementById('retenciones').value) || 0;
        total = total + percepciones - retenciones;
        
        // Actualizar campos ocultos
        document.getElementById('subtotal').value = subtotal.toFixed(2);
        document.getElementById('iva').value = iva.toFixed(2);
        document.getElementById('total').value = total.toFixed(2);
        
        // Actualizar display
        document.getElementById('display-subtotal').textContent = `$${subtotal.toFixed(2)}`;
        document.getElementById('display-iva').textContent = `$${iva.toFixed(2)}`;
        document.getElementById('display-percepciones').textContent = `$${percepciones.toFixed(2)}`;
        document.getElementById('display-total').textContent = `$${total.toFixed(2)}`;
    }
    
    // Métodos para guardar factura
    async saveFactura() {
        // Validar formulario
        if (!this.validateForm()) {
            return;
        }
        
        // Validar que haya ítems
        if (this.items.length === 0) {
            this.showAlert('Debe agregar al menos un ítem', 'danger');
            return;
        }
        
        // Preparar datos
        const facturaData = {
            proveedor_id: document.getElementById('proveedor').value,
            fecha_emision: document.getElementById('fecha_emision').value,
            fecha_recepcion: document.getElementById('fecha_recepcion').value || null,
            tipo_factura: document.getElementById('tipo_factura').value,
            punto_venta: document.getElementById('punto_venta').value || null,
            numero_factura: this.generateNumeroFacturaCompleto(),
            cae: document.getElementById('cae').value || null,
            subtotal: parseFloat(document.getElementById('subtotal').value) || 0,
            iva: parseFloat(document.getElementById('iva').value) || 0,
            percepciones: parseFloat(document.getElementById('percepciones').value) || 0,
            retenciones: parseFloat(document.getElementById('retenciones').value) || 0,
            total: parseFloat(document.getElementById('total').value) || 0,
            condicion_pago: document.getElementById('condicion_pago').value,
            observaciones: document.getElementById('observaciones').value || null,
            estado: document.getElementById('estado').value,
            items: this.items
        };
        
        try {
            const url = this.isEditing && this.currentFacturaId 
                ? `/api/facturas-compra/${this.currentFacturaId}`
                : '/api/facturas-compra';
            
            const method = this.isEditing ? 'PUT' : 'POST';
            
            let response;
            if (typeof apiFetch === 'function') {
                // Usar apiFetch para POST/PUT
                const options = {
                    method: method,
                    body: JSON.stringify(facturaData)
                };
                response = await apiFetch(url, options);
                this.showAlert(
                    this.isEditing ? 'Factura actualizada correctamente' : 'Factura creada correctamente',
                    'success'
                );
            } else {
                // Usar fetch con API_URL
                const fullUrl = `${API_URL || 'http://localhost:3000'}${url}`;
                response = await fetch(fullUrl, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify(facturaData)
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Error guardando factura');
                }
                
                const result = await response.json();
                this.showAlert(
                    this.isEditing ? 'Factura actualizada correctamente' : 'Factura creada correctamente',
                    'success'
                );
            }
            
            // Limpiar formulario
            this.clearForm();
            
            // Redirigir a lista de facturas
            setTimeout(() => {
                window.location.href = 'facturas-lista-simple.html';
            }, 2000);
            
        } catch (error) {
            console.error('Error:', error);
            this.showAlert(`Error: ${error.message}`, 'danger');
        }
    }
    
    validateForm() {
        const requiredFields = [
            'proveedor',
            'fecha_emision',
            'tipo_factura'
        ];
        
        for (const fieldId of requiredFields) {
            const field = document.getElementById(fieldId);
            if (!field.value.trim()) {
                this.showAlert(`El campo ${field.previousElementSibling?.textContent || fieldId} es obligatorio`, 'danger');
                field.focus();
                return false;
            }
        }
        
        // Validar campos de número de factura
        const puntoVenta = document.getElementById('punto_venta').value;
        const numero = document.getElementById('numero_factura').value;
        
        if (!puntoVenta || !numero) {
            this.showAlert('Punto de venta y número son obligatorios', 'danger');
            return false;
        }
        
        if (parseInt(puntoVenta) < 0 || parseInt(puntoVenta) > 9999) {
            this.showAlert('Punto de venta debe estar entre 0 y 9999', 'danger');
            return false;
        }
        
        if (parseInt(numero) < 0 || parseInt(numero) > 99999999) {
            this.showAlert('Número debe estar entre 0 y 99999999', 'danger');
            return false;
        }
        
        return true;
    }
    
    clearForm() {
        // Limpiar campos
        document.getElementById('proveedor').value = '';
        document.getElementById('cuit').textContent = '-';
        document.getElementById('telefono').textContent = '-';
        document.getElementById('direccion').textContent = '-';
        document.getElementById('tipo_factura').value = 'A';
        document.getElementById('punto_venta').value = '';
        document.getElementById('numero_factura').value = '';
        document.getElementById('cae').value = '';
        document.getElementById('fecha_emision').value = new Date().toISOString().split('T')[0];
        document.getElementById('fecha_recepcion').value = '';
        document.getElementById('condicion_pago').value = 'CONTADO';
        document.getElementById('percepciones').value = '0';
        document.getElementById('retenciones').value = '0';
        document.getElementById('observaciones').value = '';
        document.getElementById('estado').value = 'PENDIENTE';
        
        // Limpiar Select2
        if ($ && $.fn.select2) {
            $('#proveedor').val('').trigger('change');
        }
        
        // Limpiar ítems
        this.items = [];
        this.currentItemId = 1;
        this.isEditing = false;
        this.currentFacturaId = null;
        
        // Actualizar UI
        this.renderItemsTable();
        this.calculateTotals();
        this.addEmptyItem();
        
        this.showAlert('Formulario limpiado', 'info');
    }
    
    showAlert(message, type = 'info') {
        const alertContainer = document.getElementById('alert-container');
        
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>${message}</span>
                <button type="button" class="btn btn-sm" onclick="this.parentElement.parentElement.remove()" style="padding: 0; background: none; border: none; color: inherit;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        alertContainer.appendChild(alert);
        
        // Auto-remover después de 5 segundos
        setTimeout(() => {
            if (alert.parentElement) {
                alert.remove();
            }
        }, 5000);
    }
    
    // Generar número de factura completo
    generateNumeroFacturaCompleto() {
        const puntoVenta = document.getElementById('punto_venta').value || '0';
        const numero = document.getElementById('numero_factura').value || '0';
        
        // Formatear con ceros a la izquierda
        const puntoVentaFormatted = puntoVenta.padStart(4, '0');
        const numeroFormatted = numero.padStart(8, '0');
        
        return `${puntoVentaFormatted}-${numeroFormatted}`;
    }
    
    // Actualizar display del número de factura
    updateNumeroFacturaDisplay() {
        const puntoVenta = document.getElementById('punto_venta').value || '0';
        const numero = document.getElementById('numero_factura').value || '0';
        
        // Formatear con ceros a la izquierda
        const puntoVentaFormatted = puntoVenta.padStart(4, '0');
        const numeroFormatted = numero.padStart(8, '0');
        
        const displayElement = document.getElementById('display-numero-completo');
        if (displayElement) {
            displayElement.textContent = `${puntoVentaFormatted}-${numeroFormatted}`;
        }
    }
    
    // Generar siguiente número de factura
    async generateNextInvoiceNumber() {
        try {
            // Obtener el último número de factura del sistema
            const url = '/api/facturas-compra/ultimo-numero';
            let ultimoNumero = '0000-00000000';
            
            if (typeof apiFetch === 'function') {
                const data = await apiFetch(url);
                if (data.ultimo_numero) {
                    ultimoNumero = data.ultimo_numero;
                }
            } else {
                const response = await fetch(`${API_URL || 'http://localhost:3000'}${url}`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.ultimo_numero) {
                        ultimoNumero = data.ultimo_numero;
                    }
                }
            }
            
            // Parsear el último número
            const parts = ultimoNumero.split('-');
            if (parts.length === 2) {
                const puntoVenta = parseInt(parts[0]) || 1;
                let numero = parseInt(parts[1]) || 0;
                
                // Incrementar el número
                numero++;
                
                // Si el número supera 99999999, reiniciar y aumentar punto de venta
                if (numero > 99999999) {
                    numero = 1;
                    // No incrementamos punto de venta automáticamente, mantenemos el mismo
                }
                
                // Actualizar campos
                document.getElementById('punto_venta').value = puntoVenta;
                document.getElementById('numero_factura').value = numero;
                
                // Actualizar display
                this.updateNumeroFacturaDisplay();
                
                this.showAlert(`Número generado: ${puntoVenta.toString().padStart(4, '0')}-${numero.toString().padStart(8, '0')}`, 'success');
            } else {
                // Si no hay formato válido, usar valores por defecto
                document.getElementById('punto_venta').value = 1;
                document.getElementById('numero_factura').value = 1;
                this.updateNumeroFacturaDisplay();
                this.showAlert('Número generado: 0001-00000001', 'success');
            }
            
        } catch (error) {
            console.error('Error generando siguiente número:', error);
            // En caso de error, usar valores por defecto
            document.getElementById('punto_venta').value = 1;
            document.getElementById('numero_factura').value = 1;
            this.updateNumeroFacturaDisplay();
            this.showAlert('Número generado: 0001-00000001', 'info');
        }
    }
    
    // Copiar número de factura al portapapeles
    copyInvoiceNumber() {
        const displayElement = document.getElementById('display-numero-completo');
        if (!displayElement) return;
        
        const numeroCompleto = displayElement.textContent;
        
        // Usar la API del portapapeles moderna
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(numeroCompleto)
                .then(() => {
                    this.showAlert(`Número copiado: ${numeroCompleto}`, 'success');
                })
                .catch(err => {
                    console.error('Error copiando al portapapeles:', err);
                    this.fallbackCopyTextToClipboard(numeroCompleto);
                });
        } else {
            // Fallback para navegadores más antiguos o contextos no seguros
            this.fallbackCopyTextToClipboard(numeroCompleto);
        }
    }
    
    // Fallback para copiar texto al portapapeles
    fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        
        // Hacer el textarea invisible
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        
        // Seleccionar y copiar
        textArea.focus();
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                this.showAlert(`Número copiado: ${text}`, 'success');
            } else {
                this.showAlert('No se pudo copiar el número', 'danger');
            }
        } catch (err) {
            console.error('Error en fallback copy:', err);
            this.showAlert('Error copiando el número', 'danger');
        }
        
        // Limpiar
        document.body.removeChild(textArea);
    }
    
    // Calcular subtotal automáticamente
    calculateSubtotal() {
        if (this.items.length === 0) {
            this.showAlert('No hay ítems en la factura', 'warning');
            return;
        }
        
        // Recalcular subtotal de cada ítem
        this.items.forEach((item, index) => {
            item.subtotal = item.cantidad * item.precio_unitario;
            this.calculateItemTotals(index);
        });
        
        this.calculateTotals();
        this.showAlert('Subtotal recalculado', 'success');
    }
    
    // Calcular IVA automáticamente
    calculateIVA() {
        if (this.items.length === 0) {
            this.showAlert('No hay ítems en la factura', 'warning');
            return;
        }
        
        // Recalcular IVA de cada ítem
        this.items.forEach((item, index) => {
            item.iva = item.subtotal * (item.iva_porcentaje / 100);
            item.total = item.subtotal + item.iva;
            this.calculateItemTotals(index);
        });
        
        this.calculateTotals();
        this.showAlert('IVA recalculado', 'success');
    }
    
    // Agregar múltiples ítems
    addMultipleItems(count) {
        for (let i = 0; i < count; i++) {
            this.addEmptyItem();
        }
        this.showAlert(`Se agregaron ${count} ítems vacíos`, 'success');
    }
    
    // Validar todos los ítems
    validateAllItems() {
        if (this.items.length === 0) {
            this.showAlert('No hay ítems para validar', 'warning');
            return;
        }
        
        let errors = [];
        let warnings = [];
        
        this.items.forEach((item, index) => {
            const itemNumber = index + 1;
            
            // Validaciones críticas
            if (!item.nombre || item.nombre.trim() === '') {
                errors.push(`Ítem ${itemNumber}: Nombre es obligatorio`);
            }
            
            if (item.cantidad <= 0) {
                errors.push(`Ítem ${itemNumber}: Cantidad debe ser mayor a 0`);
            }
            
            if (item.precio_unitario < 0) {
                errors.push(`Ítem ${itemNumber}: Precio no puede ser negativo`);
            }
            
            if (item.iva_porcentaje < 0 || item.iva_porcentaje > 100) {
                errors.push(`Ítem ${itemNumber}: IVA % debe estar entre 0 y 100`);
            }
            
            // Advertencias
            if (item.precio_unitario === 0) {
                warnings.push(`Ítem ${itemNumber}: Precio unitario es 0`);
            }
            
            if (item.unidad_medida.trim() === '') {
                warnings.push(`Ítem ${itemNumber}: Unidad de medida está vacía`);
            }
        });
        
        // Mostrar resultados
        if (errors.length > 0) {
            const errorMessage = `Errores encontrados:<br>• ${errors.join('<br>• ')}`;
            this.showAlert(errorMessage, 'danger');
        } else if (warnings.length > 0) {
            const warningMessage = `Validación exitosa con advertencias:<br>• ${warnings.join('<br>• ')}`;
            this.showAlert(warningMessage, 'warning');
        } else {
            this.showAlert('Todos los ítems están correctamente validados', 'success');
        }
        
        return errors.length === 0;
    }
    
    // Método para verificar cálculos automáticos
    verifyCalculations() {
        let correct = true;
        let messages = [];
        
        this.items.forEach((item, index) => {
            const expectedSubtotal = item.cantidad * item.precio_unitario;
            const expectedIva = expectedSubtotal * (item.iva_porcentaje / 100);
            const expectedTotal = expectedSubtotal + expectedIva;
            
            const subtotalDiff = Math.abs(item.subtotal - expectedSubtotal);
            const ivaDiff = Math.abs(item.iva - expectedIva);
            const totalDiff = Math.abs(item.total - expectedTotal);
            
            if (subtotalDiff > 0.01) {
                messages.push(`Ítem ${index + 1}: Subtotal incorrecto (diferencia: ${subtotalDiff.toFixed(2)})`);
                correct = false;
            }
            
            if (ivaDiff > 0.01) {
                messages.push(`Ítem ${index + 1}: IVA incorrecto (diferencia: ${ivaDiff.toFixed(2)})`);
                correct = false;
            }
            
            if (totalDiff > 0.01) {
                messages.push(`Ítem ${index + 1}: Total incorrecto (diferencia: ${totalDiff.toFixed(2)})`);
                correct = false;
            }
        });
        
        if (!correct) {
            const errorMessage = `Errores en cálculos:<br>• ${messages.join('<br>• ')}`;
            this.showAlert(errorMessage, 'danger');
        } else {
            this.showAlert('Todos los cálculos son correctos', 'success');
        }
        
        return correct;
    }
    
    // Obtener el precio original de una materia prima
    getPrecioOriginal(materiaPrimaId) {
        if (!materiaPrimaId) return 0;
        
        const materiaPrima = this.materiasPrimas.find(mp => mp.id == materiaPrimaId);
        return materiaPrima ? parseFloat(materiaPrima.ultimo_precio || 0) : 0;
    }
    
    // Método para cargar una factura existente para edición
    async loadFactura(id) {
        try {
            const url = `/api/facturas-compra/${id}`;
            let factura;
            
            if (typeof apiFetch === 'function') {
                factura = await apiFetch(url);
            } else {
                const response = await fetch(`${API_URL || 'http://localhost:3000'}${url}`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    }
                });
                
                if (!response.ok) throw new Error('Error cargando factura');
                
                factura = await response.json();
            }
            
            // Llenar formulario
            document.getElementById('proveedor').value = factura.proveedor_id;
            document.getElementById('cuit').textContent = factura.proveedor_cuit || '-';
            document.getElementById('telefono').textContent = factura.proveedor_telefono || '-';
            document.getElementById('direccion').textContent = factura.proveedor_direccion || '-';
            
            // Actualizar Select2
            if ($ && $.fn.select2) {
                $('#proveedor').val(factura.proveedor_id).trigger('change');
            }
            
            document.getElementById('tipo_factura').value = factura.tipo_factura || 'A';
            
            // Parsear número de factura
            if (factura.numero_factura) {
                const parts = factura.numero_factura.split('-');
                if (parts.length === 2) {
                    document.getElementById('punto_venta').value = parseInt(parts[0]) || '';
                    document.getElementById('numero_factura').value = parseInt(parts[1]) || '';
                }
            }
            
            document.getElementById('cae').value = factura.cae || '';
            document.getElementById('fecha_emision').value = factura.fecha_emision || '';
            document.getElementById('fecha_recepcion').value = factura.fecha_recepcion || '';
            document.getElementById('condicion_pago').value = factura.condicion_pago || 'CONTADO';
            document.getElementById('percepciones').value = factura.percepciones || 0;
            document.getElementById('retenciones').value = factura.retenciones || 0;
            document.getElementById('observaciones').value = factura.observaciones || '';
            document.getElementById('estado').value = factura.estado || 'PENDIENTE';
            
            // Actualizar display del número
            this.updateNumeroFacturaDisplay();
            
            // Cargar ítems
            this.items = factura.items || [];
            this.currentItemId = this.items.length > 0 ? Math.max(...this.items.map(i => i.id)) + 1 : 1;
            this.isEditing = true;
            this.currentFacturaId = id;
            
            // Renderizar ítems
            this.renderItemsTable();
            this.calculateTotals();
            
            // Cambiar texto del botón
            document.getElementById('btn-guardar-factura').innerHTML = '<i class="fas fa-save"></i> Actualizar Factura';
            
            this.showAlert('Factura cargada para edición', 'success');
            
        } catch (error) {
            console.error('Error cargando factura:', error);
            this.showAlert('Error cargando factura para edición', 'danger');
        }
    }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    window.facturasCompra = new FacturasCompra();
    
    // Verificar si hay un ID en la URL para cargar factura
    const urlParams = new URLSearchParams(window.location.search);
    const facturaId = urlParams.get('id');
    
    if (facturaId) {
        window.facturasCompra.loadFactura(facturaId);
    }
});
    
