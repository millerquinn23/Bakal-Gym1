/* ============================================================
   BAKAL GYM — script.js
   Multi-step enrollment with AI Fitness Suggestion + Payment
   ============================================================ */

// ── BACKEND CONFIG ──────────────────────────────────────────
const API_BASE_URL = window.location.port === '3000' ? window.location.origin : 'http://localhost:3000';

const PLAN_AMOUNTS = {
  '1 Month Plan': 100,
  '2 Months Plan': 89900,
  '3 Months Plan': 129900,
  '1 Year Plan': 499900,
};

// ── HAMBURGER MENU ──────────────────────────────────────────
const hamburgerBtn = document.getElementById('hamburger-btn');
const navMenu = document.getElementById('nav-menu');

hamburgerBtn.addEventListener('click', () => {
  const isOpen = navMenu.classList.toggle('open');
  hamburgerBtn.classList.toggle('active');
  hamburgerBtn.setAttribute('aria-expanded', String(isOpen));
});

navMenu.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    navMenu.classList.remove('open');
    hamburgerBtn.classList.remove('active');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
  });
});

document.addEventListener('click', (e) => {
  if (!navMenu.contains(e.target) && !hamburgerBtn.contains(e.target)) {
    navMenu.classList.remove('open');
    hamburgerBtn.classList.remove('active');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
  }
});

// ── NAVBAR SCROLL SHADOW ────────────────────────────────────
window.addEventListener('scroll', () => {
  const navbar = document.getElementById('navbar');
  navbar.style.boxShadow = window.scrollY > 50
    ? '0 4px 24px rgba(0,0,0,0.7)'
    : '0 2px 16px rgba(0,0,0,0.4)';
});

// ── MODAL ELEMENTS ──────────────────────────────────────────
const modal = document.getElementById('payment-modal');
const modalForm = document.getElementById('payment-form');
const planNameEl = document.getElementById('modal-plan-name');
const planPriceEl = document.getElementById('modal-plan-price');
const submitBtn = document.getElementById('modal-submit-btn');

let selectedPlan = '';
let selectedPrice = '';
let currentStep = 1;
let aiSuggestionText = '';

// ── OPEN / CLOSE MODAL ──────────────────────────────────────
function openModal(planName, price) {
  selectedPlan = planName;
  selectedPrice = price;
  aiSuggestionText = '';

  planNameEl.textContent = planName;
  planPriceEl.textContent = price;

  // Reset all steps
  resetAllSteps();
  goToStep(1);

  modal.classList.add('active');
  modal.removeAttribute('aria-hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function resetAllSteps() {
  // Reset Step 1
  document.querySelectorAll('input[name="fitness_goal"]').forEach(r => r.checked = false);
  const customGroup = document.getElementById('custom-goal-group');
  if (customGroup) customGroup.style.display = 'none';
  const customInput = document.getElementById('custom-goal-input');
  if (customInput) customInput.value = '';
  hideError('error-goal');

  // Reset Step 2
  const fiSex = document.getElementById('fi-sex');
  if (fiSex) fiSex.value = '';
  ['fi-age', 'fi-weight', 'fi-height', 'fi-bmi', 'fi-bf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  hideError('error-fitness');

  // Reset Step 3
  const aiContent = document.getElementById('ai-suggestion-content');
  if (aiContent) aiContent.innerHTML = '';
  const aiStatusContainer = document.getElementById('ai-status-container');
  if (aiStatusContainer) aiStatusContainer.style.display = 'none';
  const btnPdf = document.getElementById('btn-download-pdf');
  if (btnPdf) btnPdf.style.display = 'none';
  const btnContinue = document.getElementById('btn-continue-enroll');
  if (btnContinue) btnContinue.style.display = 'none';

  // Reset Photo Upload
  if (typeof resetPhotoUpload === 'function') resetPhotoUpload();

  // Reset Step 4
  if (modalForm) modalForm.reset();
  clearAllErrors();
  setSubmitLoading(false);
}

// ── BMI CALCULATION ─────────────────────────────────────────
function calculateBMI() {
  const weightInput = document.getElementById('fi-weight');
  const heightInput = document.getElementById('fi-height');
  const bmiInput = document.getElementById('fi-bmi');

  if (!weightInput || !heightInput || !bmiInput) return;

  const weight = parseFloat(weightInput.value);
  const height = parseFloat(heightInput.value) / 100; // convert cm to m

  if (weight > 0 && height > 0) {
    const bmi = (weight / (height * height)).toFixed(1);
    bmiInput.value = bmi;
    hideError('error-fitness'); // Clear error once calculated
  } else {
    bmiInput.value = '';
  }
}

// Attach BMI listeners
['fi-weight', 'fi-height'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', calculateBMI);
});

// ── STEP NAVIGATION ─────────────────────────────────────────
function goToStep(step) {
  // Validate before going forward
  if (step > currentStep) {
    if (currentStep === 1 && !validateStep1()) return;
    if (currentStep === 2 && !validateStep2()) return;
  }

  currentStep = step;

  // Hide all steps
  document.querySelectorAll('.modal-step').forEach(s => s.classList.remove('active'));
  // Show target step
  const target = document.getElementById('step-' + step);
  if (target) target.classList.add('active');

  // Update step dots
  document.querySelectorAll('.step-dot').forEach(dot => {
    const dotStep = parseInt(dot.getAttribute('data-step'));
    dot.classList.remove('active', 'done');
    if (dotStep === step) dot.classList.add('active');
    else if (dotStep < step) dot.classList.add('done');
  });

  // Scroll modal to top
  const box = document.querySelector('.modal-box');
  if (box) box.scrollTop = 0;
}

// ── STEP 1 VALIDATION ───────────────────────────────────────
function validateStep1() {
  const selected = document.querySelector('input[name="fitness_goal"]:checked');
  if (!selected) {
    showErrorText('error-goal', 'Please select a fitness goal.');
    return false;
  }
  if (selected.value === 'Custom Goal') {
    const custom = document.getElementById('custom-goal-input').value.trim();
    if (!custom) {
      showErrorText('error-goal', 'Please enter your custom goal.');
      return false;
    }
  }
  hideError('error-goal');
  return true;
}

// ── STEP 2 VALIDATION ───────────────────────────────────────
function validateStep2() {
  const sex = document.getElementById('fi-sex').value;
  const age = document.getElementById('fi-age').value.trim();
  const weight = document.getElementById('fi-weight').value.trim();
  const height = document.getElementById('fi-height').value.trim();
  const bmi = document.getElementById('fi-bmi').value.trim();
  const bf = document.getElementById('fi-bf').value.trim();

  if (!sex) {
    showErrorText('error-fitness', 'Please select your sex.');
    return false;
  }
  if (!age || !/^\d+$/.test(age)) {
    showErrorText('error-fitness', 'Age must be a valid number.');
    return false;
  }
  if (!weight || !/^\d+(\.\d+)?$/.test(weight)) {
    showErrorText('error-fitness', 'Current Weight must be a valid number.');
    return false;
  }
  if (!height || !/^\d+(\.\d+)?$/.test(height)) {
    showErrorText('error-fitness', 'Height must be a valid number.');
    return false;
  }
  if (!bmi || !/^\d+(\.\d+)?$/.test(bmi)) {
    showErrorText('error-fitness', 'BMI must be a valid number.');
    return false;
  }
  if (bf && !/^\d+(\.\d+)?$/.test(bf)) {
    showErrorText('error-fitness', 'Body Fat % must be a valid number if provided.');
    return false;
  }
  hideError('error-fitness');
  return true;
}

// ── PHOTO UPLOAD HANDLING ────────────────────────────────────
const photoUploadZone = document.getElementById('photo-upload-zone');
const photoInput = document.getElementById('fi-photo');
const photoPreviewContainer = document.getElementById('photo-preview-container');
const photoPreview = document.getElementById('photo-preview');
const uploadPlaceholder = document.getElementById('upload-placeholder');
const btnRemovePhoto = document.getElementById('btn-remove-photo');

let base64Image = null;

if (photoUploadZone) {
  photoUploadZone.addEventListener('click', () => photoInput.click());
  
  photoUploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    photoUploadZone.classList.add('drag-over');
  });

  photoUploadZone.addEventListener('dragleave', () => {
    photoUploadZone.classList.remove('drag-over');
  });

  photoUploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    photoUploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
      handlePhotoFile(e.dataTransfer.files[0]);
    }
  });

  photoInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      handlePhotoFile(e.target.files[0]);
    }
  });

  btnRemovePhoto.addEventListener('click', (e) => {
    e.stopPropagation();
    resetPhotoUpload();
  });
}

function handlePhotoFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('Please upload an image file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    base64Image = e.target.result;
    photoPreview.src = base64Image;
    photoPreviewContainer.style.display = 'block';
    uploadPlaceholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function resetPhotoUpload() {
  base64Image = null;
  photoInput.value = '';
  photoPreview.src = '';
  photoPreviewContainer.style.display = 'none';
  uploadPlaceholder.style.display = 'block';
}

// ── GENERATE AI SUGGESTION ──────────────────────────────────
async function generateSuggestion() {
  if (!validateStep2()) return;

  const btnGen = document.getElementById('btn-generate');
  btnGen.disabled = true;
  btnGen.textContent = 'Analyzing...';

  // Move to step 3 and show scanning animation
  currentStep = 3;
  document.querySelectorAll('.modal-step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-3').classList.add('active');
  document.querySelectorAll('.step-dot').forEach(dot => {
    const ds = parseInt(dot.getAttribute('data-step'));
    dot.classList.remove('active', 'done');
    if (ds === 3) dot.classList.add('active');
    else if (ds < 3) dot.classList.add('done');
  });

  const aiStatusContainer = document.getElementById('ai-status-container');
  const aiContent = document.getElementById('ai-suggestion-content');
  const aiLoadingText = document.getElementById('ai-loading-text');
  
  aiStatusContainer.style.display = 'block';
  aiContent.innerHTML = '';
  aiLoadingText.textContent = 'ANALYZING BIOMETRICS...';

  const goalRadio = document.querySelector('input[name="fitness_goal"]:checked');
  const fitnessGoal = goalRadio ? goalRadio.value : '';
  const customGoal = fitnessGoal === 'Custom Goal' ? document.getElementById('custom-goal-input').value.trim() : '';

  const payload = {
    fitness_goal: fitnessGoal,
    custom_goal: customGoal,
    sex: document.getElementById('fi-sex').value,
    age: document.getElementById('fi-age').value.trim(),
    current_weight: document.getElementById('fi-weight').value.trim(),
    height: document.getElementById('fi-height').value.trim(),
    bmi: document.getElementById('fi-bmi').value.trim(),
    body_fat_percentage: document.getElementById('fi-bf').value.trim() || null,
    physique_photo: base64Image, // Send the base64 image
    selected_plan: selectedPlan,
  };

  try {
    // Artificial delay for futuristic UX feel
    setTimeout(() => { aiLoadingText.textContent = 'NEURAL PATTERN ANALYSIS...'; }, 800);
    setTimeout(() => { aiLoadingText.textContent = 'OPTIMIZING TRAINING REGIMEN...'; }, 1600);

    const resp = await fetch(`${API_BASE_URL}/api/generate-fitness-suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();
    if (data.success) {
      aiSuggestionText = data.suggestion;
    } else {
      aiSuggestionText = 'Error: ' + (data.message || 'Unknown error occurred.');
    }
  } catch (err) {
    console.error('AI suggestion error:', err);
    aiSuggestionText = 'Unable to connect to the server. Please try again later.';
  }

  aiStatusContainer.style.display = 'none';

  // 1. USER SUMMARY
  const sex = document.getElementById('fi-sex').value;
  const age = document.getElementById('fi-age').value.trim();
  const weight = document.getElementById('fi-weight').value.trim();
  const height = document.getElementById('fi-height').value.trim();
  const bmi = document.getElementById('fi-bmi').value.trim();
  const goalText = fitnessGoal === 'Custom Goal' && customGoal ? customGoal : fitnessGoal;

  let html = `
    <div class="ai-user-summary">
      <span><strong>Goal:</strong> ${escapeHtml(goalText)}</span>
      <span><strong>Age:</strong> ${escapeHtml(age)}</span>
      <span><strong>Weight:</strong> ${escapeHtml(weight)}kg</span>
      <span><strong>Height:</strong> ${escapeHtml(height)}cm</span>
      <span><strong>BMI:</strong> ${escapeHtml(bmi)}</span>
      ${base64Image ? '<span><strong>Physique Analysis:</strong> ACTIVE</span>' : ''}
    </div>
  `;

  // 2. PARSE SECTIONS
  // The AI returns: WEEKLY WORKOUT PLAN:, NUTRITION PLAN:, NOTES:, DISCLAIMER:
  const text = aiSuggestionText;

  // Extract Weekly Plan
  const weeklyMatch = text.match(/WEEKLY WORKOUT PLAN:([\s\S]*?)NUTRITION PLAN:/i);
  if (weeklyMatch) {
    html += '<h3 class="ai-section-heading">Weekly Workout Plan</h3>';
    html += '<div class="ai-weekly-grid">';
    const days = weeklyMatch[1].trim().split(/\n(?=[A-Z][a-z]+:)/);
    days.forEach(dayStr => {
      const parts = dayStr.split(':');
      if (parts.length >= 2) {
        const dayName = parts[0].trim();
        const content = parts.slice(1).join(':').trim();
        const exercises = content.split('\n').map(ex => ex.replace(/^-\s*/, '').trim()).filter(Boolean);
        
        html += `
          <div class="ai-day-card">
            <h4>${escapeHtml(dayName)}</h4>
            <ul>
              ${exercises.map(ex => `<li>${escapeHtml(ex)}</li>`).join('')}
            </ul>
          </div>
        `;
      }
    });
    html += '</div>';
  }

  // Extract Nutrition
  const nutritionMatch = text.match(/NUTRITION PLAN:([\s\S]*?)NOTES:/i);
  if (nutritionMatch) {
    html += '<h3 class="ai-section-heading">Nutrition Plan</h3>';
    html += '<div class="ai-nutrition-box">';
    const lines = nutritionMatch[1].trim().split('\n').filter(Boolean);
    lines.forEach(line => {
      html += `<p>${escapeHtml(line.trim())}</p>`;
    });
    html += '</div>';
  }

  // Extract Notes
  const notesMatch = text.match(/NOTES:([\s\S]*?)DISCLAIMER:/i);
  if (notesMatch) {
    html += '<h3 class="ai-section-heading">Notes</h3>';
    html += '<ul class="ai-notes-list">';
    const lines = notesMatch[1].trim().split('\n').filter(Boolean);
    lines.forEach(line => {
      html += `<li>${escapeHtml(line.replace(/^-\s*/, '').trim())}</li>`;
    });
    html += '</ul>';
  }

  // Extract Disclaimer
  const disclaimerMatch = text.match(/DISCLAIMER:([\s\S]*)$/i);
  if (disclaimerMatch) {
    html += `<div class="ai-disclaimer-text">${escapeHtml(disclaimerMatch[1].trim().replace(/^-\s*/, ''))}</div>`;
  } else {
    // Fallback if regex fails but we have text
    if (!weeklyMatch && !nutritionMatch) {
        html += `<div class="ai-section-text">${escapeHtml(text)}</div>`;
    }
  }

  aiContent.innerHTML = html;

  // Show buttons
  document.getElementById('btn-download-pdf').style.display = 'inline-block';
  document.getElementById('btn-continue-enroll').style.display = 'inline-block';

  // Reset generate button
  btnGen.disabled = false;
  btnGen.textContent = 'Generate AI Suggestion';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── PDF DOWNLOAD ────────────────────────────────────────────
function downloadPDF() {
  try {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) throw new Error('jsPDF library not loaded.');

    const doc = new jsPDF();
    const margin = 20;
    let y = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const maxWidth = pageWidth - margin * 2;

    // Title
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('BAKAL GYM', margin, y);
    y += 8;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('AI Fitness Recommendation Report', margin, y);
    y += 12;

    // Divider
    doc.setDrawColor(227, 38, 54);
    doc.setLineWidth(0.8);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    // User Info
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Enrollment Details', margin, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    const goalRadio = document.querySelector('input[name="fitness_goal"]:checked');
    const fitnessGoal = goalRadio ? goalRadio.value : 'N/A';
    const customGoalEl = document.getElementById('custom-goal-input');
    const customGoal = (fitnessGoal === 'Custom Goal' && customGoalEl) ? customGoalEl.value.trim() : '';
    const goalDisplay = customGoal || fitnessGoal;

    const info = [
      ['Selected Plan', (selectedPlan || 'N/A') + ' (' + (selectedPrice || 'N/A') + ')'],
      ['Fitness Goal', goalDisplay],
      ['Sex', document.getElementById('fi-sex')?.value || 'N/A'],
      ['Age', document.getElementById('fi-age')?.value?.trim() || 'N/A'],
      ['Current Weight', (document.getElementById('fi-weight')?.value?.trim() || 'N/A') + ' kg'],
      ['Height', (document.getElementById('fi-height')?.value?.trim() || 'N/A') + ' cm'],
      ['BMI', document.getElementById('fi-bmi')?.value?.trim() || 'N/A'],
    ];

    const bf = document.getElementById('fi-bf')?.value?.trim();
    if (bf) info.push(['Body Fat %', bf + '%']);

    info.forEach(([label, val]) => {
      doc.setFont('helvetica', 'bold');
      doc.text(label + ':', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(String(val), margin + 45, y);
      y += 6;
    });

    y += 6;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    // AI Suggestion Parsing
    const text = aiSuggestionText || 'No suggestion data available.';
    
    // Helper to find and print a section
    function addSection(title, regex, color) {
      const match = text.match(regex);
      if (match && match[1]) {
        if (y > 250) { doc.addPage(); y = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(color[0], color[1], color[2]);
        doc.text(title, margin, y);
        y += 8;
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        
        const content = match[1].trim();
        const splitText = doc.splitTextToSize(content, maxWidth);
        doc.text(splitText, margin, y);
        y += (splitText.length * 5) + 10;
        return true;
      }
      return false;
    }

    const hasWorkout = addSection('WEEKLY WORKOUT PLAN', /WEEKLY WORKOUT PLAN:([\s\S]*?)(NUTRITION PLAN:|NOTES:|DISCLAIMER:|$)/i, [227, 38, 54]);
    const hasNutrition = addSection('NUTRITION PLAN', /NUTRITION PLAN:([\s\S]*?)(NOTES:|DISCLAIMER:|$)/i, [227, 38, 54]);
    const hasNotes = addSection('NOTES', /NOTES:([\s\S]*?)(DISCLAIMER:|$)/i, [227, 38, 54]);

    if (!hasWorkout && !hasNutrition) {
      // Complete fallback for non-structured text
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const splitText = doc.splitTextToSize(text, maxWidth);
      doc.text(splitText, margin, y);
    }

    doc.save('Bakal_Gym_Fitness_Report.pdf');
  } catch (err) {
    console.error('PDF Error:', err);
    alert('Failed to generate PDF. Please try again.');
  }
}

// ── NUMBERS ONLY — CONTACT FIELD ────────────────────────────
const contactInput = document.getElementById('modal-contact');
if (contactInput) {
  contactInput.addEventListener('keydown', (e) => {
    const allowed = [
      'Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft',
      'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'
    ];
    if (allowed.includes(e.key)) return;
    if (e.ctrlKey || e.metaKey) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  });

  contactInput.addEventListener('input', () => {
    const pos = contactInput.selectionStart;
    const cleaned = contactInput.value.replace(/\D/g, '');
    if (contactInput.value !== cleaned) {
      contactInput.value = cleaned;
      contactInput.setSelectionRange(pos - 1, pos - 1);
    }
  });
}

// ── NUMBERS ONLY — FITNESS FIELDS ───────────────────────────
['fi-age', 'fi-weight', 'fi-height', 'fi-bmi', 'fi-bf'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    // Allow digits and one decimal point (except age which is integer only)
    if (id === 'fi-age') {
      el.value = el.value.replace(/\D/g, '');
    } else {
      el.value = el.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
    }
  });
});

// ── CUSTOM GOAL TOGGLE ──────────────────────────────────────
document.querySelectorAll('input[name="fitness_goal"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const customGroup = document.getElementById('custom-goal-group');
    if (radio.value === 'Custom Goal') {
      customGroup.style.display = 'block';
    } else {
      customGroup.style.display = 'none';
    }
    hideError('error-goal');
  });
});

// ── ERROR HELPERS ───────────────────────────────────────────
function showError(inputId, errorId, message) {
  const input = document.getElementById(inputId);
  const error = document.getElementById(errorId);
  if (!input || !error) return;

  error.textContent = message;
  error.classList.add('visible');
  input.classList.add('input-error');
}

function clearError(inputId, errorId) {
  const input = document.getElementById(inputId);
  const error = document.getElementById(errorId);
  if (!input || !error) return;

  error.textContent = '';
  error.classList.remove('visible');
  input.classList.remove('input-error');
}

function showErrorText(errorId, message) {
  const error = document.getElementById(errorId);
  if (!error) return;
  error.textContent = message;
  error.classList.add('visible');
}

function hideError(errorId) {
  const error = document.getElementById(errorId);
  if (!error) return;
  error.textContent = '';
  error.classList.remove('visible');
}

function clearAllErrors() {
  clearError('modal-name', 'error-name');
  clearError('modal-contact', 'error-contact');
  clearError('modal-email', 'error-email');
  hideError('error-goal');
  hideError('error-fitness');
}

function setSubmitLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.textContent = loading ? 'Processing…' : 'Proceed to Payment';
}

// Clear field errors on input
['modal-name', 'modal-contact', 'modal-email'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', () => {
      const errId = 'error-' + id.replace('modal-', '');
      clearError(id, errId);
    });
  }
});

// ── FORM VALIDATION (Step 4) ────────────────────────────────
function validateForm(name, contact, email) {
  let valid = true;

  if (!name) {
    showError('modal-name', 'error-name', 'Please enter your full name.');
    valid = false;
  }

  if (!contact) {
    showError('modal-contact', 'error-contact', 'Please enter your contact number.');
    valid = false;
  } else if (!/^09\d{9}$/.test(contact)) {
    showError('modal-contact', 'error-contact', 'Enter a valid PH number (e.g. 09XXXXXXXXX).');
    valid = false;
  }

  if (!email) {
    showError('modal-email', 'error-email', 'Please enter your email address.');
    valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError('modal-email', 'error-email', 'Enter a valid email address (e.g. juan@email.com).');
    valid = false;
  }

  return valid;
}

// ── FORM SUBMIT → BACKEND → PAYMONGO ───────────────────────
async function submitPayment(e) {
  e.preventDefault();
  clearAllErrors();

  const name = document.getElementById('modal-name').value.trim();
  const contact = document.getElementById('modal-contact').value.trim();
  const email = document.getElementById('modal-email').value.trim();

  if (!validateForm(name, contact, email)) {
    const firstError = modalForm.querySelector('.input-error');
    if (firstError) firstError.focus();
    return;
  }

  setSubmitLoading(true);

  // Gather fitness data
  const goalRadio = document.querySelector('input[name="fitness_goal"]:checked');
  const fitnessGoal = goalRadio ? goalRadio.value : '';
  const customGoal = fitnessGoal === 'Custom Goal' ? document.getElementById('custom-goal-input').value.trim() : '';

  try {
    const response = await fetch(`${API_BASE_URL}/api/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_name: selectedPlan,
        amount: PLAN_AMOUNTS[selectedPlan],
        currency: 'PHP',
        name: name,
        email: email,
        contact: contact,
        description: `Bakal Gym – ${selectedPlan}`,
        fitness_goal: fitnessGoal,
        custom_goal: customGoal || null,
        sex: document.getElementById('fi-sex').value,
        age: document.getElementById('fi-age').value.trim(),
        current_weight: document.getElementById('fi-weight').value.trim(),
        height: document.getElementById('fi-height').value.trim(),
        bmi: document.getElementById('fi-bmi').value.trim(),
        body_fat_percentage: document.getElementById('fi-bf').value.trim() || null,
        ai_fitness_suggestion: aiSuggestionText || null,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `Server error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.checkout_url) {
      throw new Error('No checkout URL returned from server.');
    }

    window.location.href = data.checkout_url;

  } catch (err) {
    console.error('Payment error:', err);
    setSubmitLoading(false);
    showError('modal-email', 'error-email',
      'Payment could not be initiated. Please try again or contact Bakal Gym.'
    );
  }
}

// Close modal on overlay click
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
});

// ── EXPOSE GLOBALS ──────────────────────────────────────────
window.openModal = openModal;
window.closeModal = closeModal;
window.submitPayment = submitPayment;
window.goToStep = goToStep;
window.generateSuggestion = generateSuggestion;
window.downloadPDF = downloadPDF;
