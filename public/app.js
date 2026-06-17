function prescriptionApp() {
    return {
        view: 'dashboard',
        prescriptions: [],
        searchQuery: '',
        showModal: false,
        showDetailModal: false,
        showRefModal: false,
        selectedPrescription: null,
        isEditing: false,
        
        // Advanced Filters
        activeFilters: {
            medicines: true,
            symptoms: true,
            diagnosis: true,
            bloodTest: false,
            bill: false
        },

        form: {
            id: null,
            parentId: null,
            childName: '',
            dob: '',
            calculatedAge: '',
            weight: '',
            height: '',
            bmi: '',
            vitals: { temp: '', pulse: '', bp: '', rr: '', spo2: '' },
            date: new Date().toISOString().split('T')[0],
            symptoms: '',
            diagnosis: '',
            doctorName: '',
            hospitalName: '',
            medicines: [],
            attachments: {
                prescription: [],
                medicine: [],
                bill: [],
                bloodTest: []
            }
        },

        async init() {
            await this.fetchPrescriptions();
            this.$watch('form.weight', () => this.calculateBMI());
            this.$watch('form.height', () => this.calculateBMI());
            this.$watch('form.dob', value => { if (value) this.form.calculatedAge = this.calculateAge(value, this.form.date); });
            this.$watch('form.date', value => { if (this.form.dob) this.form.calculatedAge = this.calculateAge(this.form.dob, value); });
        },

        calculateBMI() {
            const weight = parseFloat(this.form.weight);
            const heightCm = parseFloat(this.form.height);
            if (weight > 0 && heightCm > 0) {
                const heightM = heightCm / 100;
                this.form.bmi = (weight / (heightM * heightM)).toFixed(1);
            } else {
                this.form.bmi = '';
            }
        },

        calculateAge(dob, refDate) {
            const birth = new Date(dob);
            const ref = new Date(refDate);
            const diffTime = ref - birth;
            if (diffTime < 0) return 'Not born yet';
            const exactYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
            return exactYears >= 2 ? exactYears.toFixed(2) + ' years' : (exactYears * 12).toFixed(2) + ' months';
        },

        async fetchPrescriptions() {
            try {
                const response = await fetch('/api/prescriptions');
                this.prescriptions = await response.json();
            } catch (error) { console.error('Error fetching prescriptions:', error); }
        },

        get filteredPrescriptions() {
            let filtered = this.prescriptions;
            const q = this.searchQuery.toLowerCase();

            if (q || Object.values(this.activeFilters).some(v => v)) {
                filtered = filtered.filter(p => {
                    const matchesSearch = !q || (
                        (this.activeFilters.medicines && p.medicines.some(m => (m.name || '').toLowerCase().includes(q))) ||
                        (this.activeFilters.symptoms && (p.symptoms || '').toLowerCase().includes(q)) ||
                        (this.activeFilters.diagnosis && (p.diagnosis || '').toLowerCase().includes(q)) ||
                        (p.childName || '').toLowerCase().includes(q)
                    );

                    const matchesBloodTest = !this.activeFilters.bloodTest || (p.attachments?.bloodTest?.length > 0);
                    const matchesBill = !this.activeFilters.bill || (p.attachments?.bill?.length > 0);

                    return matchesSearch && matchesBloodTest && matchesBill;
                });
            }
            return filtered;
        },

        get growthData() {
            const data = {};
            [...this.prescriptions].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(p => {
                if (!data[p.childName]) data[p.childName] = [];
                data[p.childName].push({ date: p.date, weight: p.weight, height: p.height, bmi: p.bmi, age: p.calculatedAge });
            });
            return data;
        },

        reuseData(p) {
            const data = JSON.parse(JSON.stringify(p));
            if (!data.vitals) {
                data.vitals = { temp: '', pulse: '', bp: '', rr: '', spo2: '' };
            }
            this.form = {
                ...data,
                id: null,
                parentId: p.id,
                date: new Date().toISOString().split('T')[0],
                attachments: { prescription: [], medicine: [], bill: [], bloodTest: [] }
            };
            this.isEditing = false;
            this.showModal = true;
            this.showDetailModal = false;
        },

        editData(p) {
            const data = JSON.parse(JSON.stringify(p));
            if (!data.vitals) {
                data.vitals = { temp: '', pulse: '', bp: '', rr: '', spo2: '' };
            }
            // Ensure attachments are arrays for older data
            if (data.attachments) {
                Object.keys(data.attachments).forEach(key => {
                    if (!Array.isArray(data.attachments[key])) {
                        data.attachments[key] = data.attachments[key] ? [data.attachments[key]] : [];
                    }
                });
            } else {
                data.attachments = { prescription: [], medicine: [], bill: [], bloodTest: [] };
            }
            this.form = data;
            this.isEditing = true;
            this.showModal = true;
            this.showDetailModal = false;
        },

        openAddModal() {
            this.isEditing = false;
            this.form = {
                id: null, parentId: null, childName: '', dob: '', calculatedAge: '', weight: '', height: '', bmi: '',
                vitals: { temp: '', pulse: '', bp: '', rr: '', spo2: '' },
                date: new Date().toISOString().split('T')[0], symptoms: '', diagnosis: '', doctorName: '', hospitalName: '',
                medicines: [{ name: '', type: 'liquid', purpose: '', dosage: '', unit: 'ml', frequency: '', duration: '', instructions: '' }],
                attachments: { prescription: [], medicine: [], bill: [], bloodTest: [] }
            };
            this.showModal = true;
        },

        addMedicine() {
            this.form.medicines.push({ name: '', type: 'liquid', purpose: '', dosage: '', unit: 'ml', frequency: '', duration: '', instructions: '' });
        },

        removeMedicine(index) { this.form.medicines.splice(index, 1); },

        async handleFileUpload(event, type) {
            const files = event.target.files;
            if (!files.length) return;

            const formData = new FormData();
            for (let i = 0; i < files.length; i++) {
                formData.append('images', files[i]);
            }

            try {
                const response = await fetch('/api/upload', { method: 'POST', body: formData });
                const result = await response.json();
                this.form.attachments[type] = [...(this.form.attachments[type] || []), ...result.filePaths];
            } catch (error) {
                console.error('Error uploading files:', error);
                alert('Upload failed');
            }
        },

        removeAttachment(type, index) {
            this.form.attachments[type].splice(index, 1);
        },

        async savePrescription() {
            try {
                const url = this.isEditing ? `/api/prescriptions/${this.form.id}` : '/api/prescriptions';
                const method = this.isEditing ? 'PUT' : 'POST';
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.form)
                });
                if (response.ok) {
                    await this.fetchPrescriptions();
                    this.showModal = false;
                    alert(this.isEditing ? 'Record updated!' : 'Prescription saved!');
                }
            } catch (error) { console.error('Error saving:', error); alert('Save failed'); }
        },

        showPrescription(p) {
            this.selectedPrescription = p;
            this.showDetailModal = true;
        },

        async deletePrescription(id) {
            if (!confirm('Are you sure you want to delete this record?')) return;
            try {
                const response = await fetch(`/api/prescriptions/${id}`, { method: 'DELETE' });
                if (response.ok) {
                    await this.fetchPrescriptions();
                    this.showDetailModal = false;
                    alert('Record deleted');
                }
            } catch (error) { console.error('Error deleting prescription:', error); }
        },

        formatDate(dateStr) {
            if (!dateStr) return '';
            return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        },

        printPrescription() { window.print(); },

        async exportData(embedImages = false) {
            try {
                const response = await fetch(`/api/export?embed=${embedImages}`);
                const data = await response.json();
                
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `KiddoHealth_Backup_${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (error) {
                console.error('Export failed:', error);
                alert('Export failed');
            }
        },

        triggerImport() {
            document.getElementById('import-file').click();
        },

        async importData(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const jsonData = JSON.parse(e.target.result);
                    const response = await fetch('/api/import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(jsonData)
                    });
                    
                    if (response.ok) {
                        alert('Import successful! Data merged.');
                        await this.fetchPrescriptions();
                    } else {
                        alert('Import failed: Server rejected data');
                    }
                } catch (err) {
                    console.error('Import error:', err);
                    alert('Invalid JSON file or import error.');
                }
            };
            reader.readAsText(file);
            event.target.value = '';
        }
    };
}
