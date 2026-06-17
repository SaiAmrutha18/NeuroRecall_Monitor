
    // Google Maps callback
    window.initMapPlaceholder = function () { 
      console.log(" Maps API Initialized"); 
      // If we are already on the GPS screen, init the map
      var gpsSec = document.getElementById('sec-gps');
      if (gpsSec && gpsSec.classList.contains('active')) initLiveGPS();
    };

    //  STARTUP PING 
    (function(){
      var b = document.querySelector('.auth-bar');
      if(b) { b.style.height = '10px'; setTimeout(function(){ b.style.height = '4px'; }, 1000); }
    })();

    //  GLOBAL STATE 
    var CU = null;
    var _curPat = null;
    var _pendingLogin = null;
    var _pendingReg = null;
    var _pendingFP = null;
    var _lastGpsSync = 0;
    var _otps = {};

    //  STORAGE 
    var DB = {
      get: function (k) { try { return JSON.parse(localStorage.getItem('nr_' + k)); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem('nr_' + k, JSON.stringify(v)); } catch (e) { } },
      del: function (k) { try { localStorage.removeItem('nr_' + k); } catch (e) { } }
    };
    var getUsers = function () { return DB.get('users') || []; };
    var saveUsers = function (u) { DB.set('users', u); };
    var getPatients = function () { return DB.get('patients') || []; };
    var savePats = function (p) { DB.set('patients', p); };
    var getAudit = function () { return DB.get('audit') || []; };
    var saveAudit = function (a) { DB.set('audit', a); };

    //  EVENT UTILS 
    function on(id, ev, fn) { 
      var el = document.getElementById(id); 
      if (el) el.addEventListener(ev, fn); 
    }
    function onAll(sel, ev, fn) { 
      var els = document.querySelectorAll(sel);
      for(var i=0; i<els.length; i++) els[i].addEventListener(ev, fn);
    }

      //  TOAST 
      function toast(type, msg) {
        console.log("Toast [" + type + "]: " + msg);
        var w = document.getElementById('tc'); if (!w) return;
        var t = document.createElement('div');
        t.className = 'toast ' + type;
        var icons = { success: 'OK', error: '!', info: 'i', warn: '!' };
        t.innerHTML = '<span class="ti">' + (icons[type] || 'i') + '</span><span class="tm">' + msg + '</span>';
        w.appendChild(t);
        setTimeout(function () {
          t.style.animation = 'tOut .3s ease forwards';
          setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
        }, 3800);
      }

      //  AUDIT 
      function addAudit(action, target, status) {
        var logs = getAudit();
        logs.unshift({
          id: Date.now(), timestamp: new Date().toISOString(),
          user: CU ? CU.name : 'System', role: CU ? CU.role : 'system',
          action: action, target: target || '-', status: status || 'OK'
        });
        if (logs.length > 200) logs = logs.slice(0, 200);
        saveAudit(logs);
      }

      //  OTP ENGINE 
      var _otps = {};
      function genOTP() { return String(Math.floor(100000 + Math.random() * 900000)); }

      // System 1: Real Email OTP Logic (via EmailJS)
      if (window.emailjs) {
        try {
          emailjs.init("p_kxQe7dRZHSu9Mjm");
          console.log("EmailJS Initialized");
        } catch(e) { console.error("EmailJS Init Fail", e); }
      } else {
        console.warn("EmailJS library not discovered on window");
      }

      function sendRealOTP(email, code, name) {
        if (!window.emailjs) {
          toast('error', 'Email Service library failed to load');
          return Promise.resolve(false);
        }
        // Using the publicKey from .env already initialized
        return emailjs.send("service_4og4ty7", "template_0abagpv", {
          to_email: email,
          to_name: name || 'User',
          otp_code: code,
          from_name: "NeuroRecall System",
          message: "Your verification code is " + code,
          reply_to: "no-reply@neurorecall.com"
        }).then(function(res) {
          console.log("OTP Sent via EmailJS to " + email);
          return true;
        }, function(err) {
          console.error("EmailJS Error", err);
          return false;
        });
      }

      function saveOTP(k, otp) { _otps[k] = { otp: otp, exp: Date.now() + 600000 }; }
      function checkOTP(k, inp) {
        var e = _otps[k]; if (!e) return false;
        if (Date.now() > e.exp) { delete _otps[k]; return false; }
        if (String(e.otp) !== String(inp).trim()) return false;
        delete _otps[k]; return true;
      }
      function startTimer(id) {
        var el = document.getElementById(id); if (!el) return;
        if (el._iv) clearInterval(el._iv);
        var rem = 600;
        el._iv = setInterval(function () {
          rem--;
          var m = Math.floor(rem / 60), s = rem % 60;
          el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
          if (rem <= 0) { clearInterval(el._iv); el.textContent = 'Expired'; }
        }, 1000);
      }
      function showOTP(boxId, otp, email) {
        var box = document.getElementById(boxId); if (!box) return;
        box.innerHTML = 'A 6-digit verification code has been sent to your email:<br><strong style="color:var(--accent)">' + email + '</strong><br><small style="color:var(--text3);font-size:.68rem">Please enter it below to securely log in.</small>';
        box.style.display = 'block';
      }
      function clearBoxes(prefix) {
        for (var i = 0; i < 6; i++) {
          var b = document.getElementById(prefix + '-otp-' + i);
          if (b) { b.value = ''; b.classList.remove('filled'); }
        }
      }
      function getOTPVal(prefix) {
        var s = '';
        for (var i = 0; i < 6; i++) {
          var b = document.getElementById(prefix + '-otp-' + i);
          s += b ? b.value.trim() : '';
        }
        return s;
      }

      //  TAB SWITCHING 
      function switchTab(tab) {
        console.log("Switching to tab: " + tab);
        
        // Update Buttons
        var tabBtns = { login: 'tab-login', register: 'tab-register', forgot: 'tab-forgot' };
        for (var key in tabBtns) {
          var btn = document.getElementById(tabBtns[key]);
          if (btn) {
            if (key === tab) btn.classList.add('active');
            else btn.classList.remove('active');
          }
        }

        // Update Flows
        var flowIds = { login: 'flow-login', register: 'flow-register', forgot: 'flow-forgot' };
        for (var flowKey in flowIds) {
          var fl = document.getElementById(flowIds[flowKey]);
          if (fl) {
            if (flowKey === tab) {
              fl.style.display = 'block';
              fl.classList.add('active');
            } else {
              fl.style.display = 'none';
              fl.classList.remove('active');
            }
          }
        }

        // Reset Steps
        var stepMap = { login: 'login-s1', register: 'reg-s1', forgot: 'fp-s1' };
        var activeFlow = document.getElementById('flow-' + tab);
        if (activeFlow) {
          var activeSteps = activeFlow.querySelectorAll('.auth-step');
          for (var i = 0; i < activeSteps.length; i++) {
            activeSteps[i].classList.remove('active');
          }
          var targetStep = document.getElementById(stepMap[tab]);
          if (targetStep) targetStep.classList.add('active');
        }

        clearBoxes('l'); clearBoxes('r'); clearBoxes('fp');
      }

      function gotoStep(flow, stepId) {
        var flowEl = document.getElementById('flow-' + flow); if (!flowEl) return;
        var steps = flowEl.querySelectorAll('.auth-step');
        for (var i = 0; i < steps.length; i++) steps[i].classList.remove('active');
        var el = document.getElementById(stepId); if (el) el.classList.add('active');
      }

      //  PASSWORD STRENGTH 
      function checkPW(pw, barId, hintId) {
        var bar = document.getElementById(barId); if (!bar) return;
        var s = 0;
        if (pw.length >= 8) s++; if (/[A-Z]/.test(pw)) s++;
        if (/[0-9]/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++; if (pw.length >= 12) s++;
        var lvls = [[20, '#ff3d6b', 'Weak'], [40, '#ff7a3d', 'Fair'], [60, '#ffaa33', 'Good'], [80, '#00e896', 'Strong'], [100, '#00b4ff', 'Very Strong']];
        var l = lvls[Math.min(s, 4)];
        bar.style.width = l[0] + '%'; bar.style.background = l[1];
        var hint = document.getElementById(hintId); if (hint) { hint.textContent = l[2]; hint.style.color = l[1]; }
      }

      //  SET BUTTON LOADING 
      function btnLoad(id, on, label) {
        var b = document.getElementById(id); if (!b) return;
        b.disabled = on;
        b.textContent = on ? 'WAIT Please wait...' : (label || b._lbl || b.textContent);
        if (!on && label) b._lbl = label;
      }

      // -- LOGIN ---------------------------------------------------------
      function loginStep1() {
        var email = (document.getElementById('l-email').value || '').trim().toLowerCase();
        var pass = document.getElementById('l-pass').value;
        if (!email || !pass) { toast('error', 'Enter email and password'); return; }
        btnLoad('btn-login1', true, 'Continue ->');

        // Ensure demo account exists
        if (email === 'demo@neurorecall.com' && pass === 'Demo@2024') {
          var us = getUsers();
          if (!us.find(function (u) { return u.email === email; })) {
            us.push({ id: 'u_demo', name: 'Dr. Demo User', email: email, password: pass, role: 'doctor', eid: 'DEMO-001', createdAt: new Date().toISOString() });
            saveUsers(us);
          }
        }

        var users = getUsers();
        var user = users.find(function (u) { return u.email === email && u.password === pass; });
        btnLoad('btn-login1', false, 'Continue ->');
        if (!user) { toast('error', 'Invalid email or password'); return; }

        var otp = genOTP();
        saveOTP('login_' + email, otp);
        window._pendingLogin = { email: email, user: user };

        // Real Email OTP Integration
        sendRealOTP(email, otp, user.name).then(function (ok) {
          if (!ok) {
            console.log("OTP Code is: " + otp);
            toast('info', 'Check your email for the code');
          }
        });

        clearBoxes('l');
        var box = document.getElementById('l-otp-box');
        if (box) { box.style.display = 'none'; }
        // showOTP('l-otp-box', otp, email); // Hide from UI as per "Must not be able to bypass until input matches"
        startTimer('l-timer');
        gotoStep('login', 'login-s2');
        setTimeout(function () { var e = document.getElementById('l-otp-0'); if (e) e.focus(); }, 200);
        toast('info', 'Verification code sent to ' + email);
      }

      function loginStep2() {
        var otp = getOTPVal('l');
        if (otp.length !== 6) { toast('error', 'Enter all 6 digits'); return; }
        if (!window._pendingLogin) { toast('error', 'Session expired'); switchTab('login'); return; }
        btnLoad('btn-login2', true, 'Verify & Sign In');
        if (!checkOTP('login_' + window._pendingLogin.email, otp)) {
          btnLoad('btn-login2', false, 'Verify & Sign In');
          toast('error', 'Incorrect or expired code'); return;
        }
        CU = window._pendingLogin.user;
        DB.set('session', { userId: CU.id, loginTime: Date.now() });
        btnLoad('btn-login2', false, 'Verify & Sign In');
        gotoStep('login', 'login-s3');
        addAudit('Login', CU.email, 'OK');
        setTimeout(function () { launchApp(CU); }, 1000);
      }

      // -- REGISTER ------------------------------------------------------
      function regStep1() {
        var name = (document.getElementById('r-name').value || '').trim();
        var email = (document.getElementById('r-email').value || '').trim().toLowerCase();
        var eid = (document.getElementById('r-eid').value || '').trim();
        var role = document.getElementById('r-role').value;
        var pass = document.getElementById('r-pass').value;
        var pass2 = document.getElementById('r-pass2').value;
        if (!name || !email || !pass) { toast('error', 'Fill all required fields'); return; }
        if (pass.length < 8) { toast('error', 'Password: min 8 characters'); return; }
        if (!/[A-Z]/.test(pass)) { toast('error', 'Password needs an uppercase letter'); return; }
        if (!/[0-9]/.test(pass)) { toast('error', 'Password needs a number'); return; }
        if (pass !== pass2) { toast('error', 'Passwords do not match'); return; }
        var users = getUsers();
        if (users.find(function (u) { return u.email === email; })) { toast('error', 'Email already registered'); return; }
        btnLoad('btn-reg1', true, 'Send Verification Code ->');
        var otp = genOTP();
        saveOTP('reg_' + email, otp);
        window._pendingReg = { name: name, email: email, pass: pass, eid: eid, role: role };

        // Real Email OTP Integration
        sendRealOTP(email, otp, name).then(function (ok) {
          if (!ok) toast('warn', 'Fallback: Code is ' + otp);
        });

        btnLoad('btn-reg1', false, 'Send Verification Code ->');
        clearBoxes('r');
        var box = document.getElementById('r-otp-box'); if (box) box.style.display = 'none';
        // showOTP('r-otp-box', otp, email);
        startTimer('r-timer');
        gotoStep('register', 'reg-s2');
        setTimeout(function () { var e = document.getElementById('r-otp-0'); if (e) e.focus(); }, 200);
        toast('info', 'Verification code sent to ' + email);
      }

      function regStep2() {
        var otp = getOTPVal('r');
        if (otp.length !== 6) { toast('error', 'Enter all 6 digits'); return; }
        if (!window._pendingReg) { toast('error', 'Session expired'); switchTab('register'); return; }
        btnLoad('btn-reg2', true, 'Create Account');
        var reg = window._pendingReg;
        if (!checkOTP('reg_' + reg.email, otp)) {
          btnLoad('btn-reg2', false, 'Create Account');
          toast('error', 'Incorrect or expired code'); return;
        }
        var users = getUsers();
        var newUser = { id: 'u_' + Date.now(), name: reg.name, email: reg.email, password: reg.pass, eid: reg.eid, role: reg.role, createdAt: new Date().toISOString() };
        users.push(newUser); saveUsers(users);
        CU = newUser;
        DB.set('session', { userId: CU.id, loginTime: Date.now() });
        btnLoad('btn-reg2', false, 'Create Account');
        gotoStep('register', 'reg-s3');
        addAudit('Register', reg.email, 'OK');
        toast('success', 'Account created!');
        setTimeout(function () { launchApp(CU); }, 1000);
      }

      // -- FORGOT PASSWORD -----------------------------------------------
      function fpStep1() {
        var email = (document.getElementById('fp-email').value || '').trim().toLowerCase();
        if (!email) { toast('error', 'Enter your email'); return; }
        btnLoad('btn-fp1', true, 'Send Reset Code ->');
        var otp = genOTP();
        saveOTP('fp_' + email, otp);
        window._pendingFP = { email: email };
        btnLoad('btn-fp1', false, 'Send Reset Code ->');
        clearBoxes('fp');
        var box = document.getElementById('fp-otp-box'); if (box) box.style.display = 'none';
        showOTP('fp-otp-box', otp, email);
        startTimer('fp-timer');
        gotoStep('forgot', 'fp-s2');
        setTimeout(function () { var e = document.getElementById('fp-otp-0'); if (e) e.focus(); }, 200);
        toast('info', 'Reset code generated - see code above');
      }

      function fpStep2() {
        var otp = getOTPVal('fp');
        if (otp.length !== 6) { toast('error', 'Enter all 6 digits'); return; }
        if (!window._pendingFP) { toast('error', 'Session expired'); switchTab('forgot'); return; }
        btnLoad('btn-fp2', true, 'Verify ->');
        if (!checkOTP('fp_' + window._pendingFP.email, otp)) {
          btnLoad('btn-fp2', false, 'Verify ->');
          toast('error', 'Incorrect or expired code'); return;
        }
        btnLoad('btn-fp2', false, 'Verify ->');
        gotoStep('forgot', 'fp-s3');
      }

      function fpStep3() {
        var np = document.getElementById('fp-np').value;
        var np2 = document.getElementById('fp-np2').value;
        if (!np || np.length < 8) { toast('error', 'Password too short'); return; }
        if (np !== np2) { toast('error', 'Passwords do not match'); return; }
        if (!window._pendingFP) { toast('error', 'Session expired'); return; }
        btnLoad('btn-fp3', true, 'Update Password ->');
        var users = getUsers();
        var idx = users.findIndex(function (u) { return u.email === window._pendingFP.email; });
        if (idx !== -1) { users[idx].password = np; saveUsers(users); }
        btnLoad('btn-fp3', false, 'Update Password ->');
        gotoStep('forgot', 'fp-s4');
        addAudit('Password Reset', window._pendingFP.email, 'OK');
        toast('success', 'Password updated!');
      }

      // -- RESEND OTP ----------------------------------------------------
      function resendOTP(flow) {
        var email = '', key = '', boxId = '', timerId = '', prefix = '';
        if (flow === 'l') { if (!window._pendingLogin) { return; } email = window._pendingLogin.email; key = 'login_' + email; boxId = 'l-otp-box'; timerId = 'l-timer'; prefix = 'l'; }
        if (flow === 'r') { if (!window._pendingReg) { return; } email = window._pendingReg.email; key = 'reg_' + email; boxId = 'r-otp-box'; timerId = 'r-timer'; prefix = 'r'; }
        if (flow === 'fp') { if (!window._pendingFP) { return; } email = window._pendingFP.email; key = 'fp_' + email; boxId = 'fp-otp-box'; timerId = 'fp-timer'; prefix = 'fp'; }
        var otp = genOTP();
        saveOTP(key, otp);
        clearBoxes(prefix);
        var box = document.getElementById(boxId); if (box) box.style.display = 'none';
        showOTP(boxId, otp, email);
        startTimer(timerId);
        toast('info', 'New code generated - see above');
      }

      // -- OTP INPUT NAV -------------------------------------------------
      function wireOTPBoxes(prefix) {
        for (var i = 0; i < 6; i++) {
          (function (idx) {
            var el = document.getElementById(prefix + '-otp-' + idx);
            if (!el) return;
            el.addEventListener('input', function () {
              this.value = this.value.replace(/\D/g, '').slice(0, 1);
              this.classList.toggle('filled', this.value.length > 0);
              if (this.value && idx < 5) { var nx = document.getElementById(prefix + '-otp-' + (idx + 1)); if (nx) nx.focus(); }
            });
            el.addEventListener('keydown', function (e) {
              if (e.key === 'Backspace' && !this.value && idx > 0) {
                var pv = document.getElementById(prefix + '-otp-' + (idx - 1));
                if (pv) { pv.value = ''; pv.classList.remove('filled'); pv.focus(); }
              }
            });
          })(i);
        }
      }

      // -- LAUNCH APP ----------------------------------------------------
      function launchApp(user) {
        var aw = document.getElementById('auth-wrap'); if (aw) aw.classList.add('gone');
        var ap = document.getElementById('app'); if (ap) { ap.style.display = ''; ap.classList.add('on'); }
        var av = (user.name || '?').split(' ').map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
        var e1 = document.getElementById('uav'); if (e1) e1.textContent = av;
        var e2 = document.getElementById('uname'); if (e2) e2.textContent = user.name;
        var e3 = document.getElementById('urole'); if (e3) e3.textContent = (user.role || '').charAt(0).toUpperCase() + (user.role || '').slice(1);
        initApp();
        toast('success', 'Welcome, ' + user.name + '!');
      }

      function doLogout() {
        CU = null; DB.del('session');
        var ap = document.getElementById('app'); if (ap) { ap.classList.remove('on'); ap.style.display = 'none'; }
        var aw = document.getElementById('auth-wrap'); if (aw) { aw.classList.remove('gone'); aw.style.display = 'flex'; }
        switchTab('login');
        toast('info', 'Signed out safely');
      }

      // -- APP NAV -------------------------------------------------------
      var secTitles = {
        dashboard: ['Dashboard', 'NeuroRecall Patient Management System'],
        alerts: ['Crisis Alerts', 'Emergency notifications'],
        patients: ['Patient Records', 'Memory patient registry'],
        addpat: ['Register Patient', 'Create new patient profile'],
        search: ['Search & Retrieve', 'Emergency record lookup'],
        meds: ['Medications', 'Schedule & compliance tracking'],
        vitals: ['Vitals Monitor', 'Patient vital signs'],
        history: ['Medical History', 'Clinical timeline'],
        reports: ['Reports & PDFs', 'Generate & download reports'],
        audit: ['Audit Log', 'Secure access trail'],
        settings: ['Settings', 'System configuration'],
        gps: ['LIVE GPS Tracking', 'Real-time movement monitor']
      };

      // System 2: Live GPS Tracking
      var liveMap, liveMarker, watchId;
      var geocoder;


      function initLiveGPS() {
        if (!window.google || !window.google.maps) return;
        
        // If already initialized, just ensure center is correct and return
        if (liveMap && liveMarker) {
          navigator.geolocation.getCurrentPosition(function(pos) {
            var coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            liveMap.setCenter(coords);
            liveMarker.setPosition(coords);
          });
          return;
        }

        geocoder = new google.maps.Geocoder();
        var center = { lat: 17.3850, lng: 78.4867 }; 
        
        liveMap = new google.maps.Map(document.getElementById('map-live'), {
          zoom: 16,
          center: center,
          mapTypeId: 'roadmap',
          styles: [
            { elementType: 'geometry', stylers: [{ color: '#020912' }] },
            { elementType: 'labels.text.fill', stylers: [{ color: '#7aa0c4' }] },
            { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#080f1e' }] }
          ]
        });

        liveMarker = new google.maps.Marker({
          map: liveMap,
          title: 'Patient Current Location',
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: "#00b4ff",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          }
        });

        function findNearby(coords) {
          if (!google.maps.places) return;
          var service = new google.maps.places.PlacesService(liveMap);
          service.nearbySearch({
            location: coords,
            radius: '2000',
            type: ['hospital', 'pharmacy', 'health']
          }, function(results, status) {
            if (status === google.maps.places.PlacesServiceStatus.OK) {
              for (var i = 0; i < results.length; i++) {
                new google.maps.Marker({
                  map: liveMap,
                  position: results[i].geometry.location,
                  title: results[i].name,
                  icon: {
                    url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
                    scaledSize: new google.maps.Size(24, 24)
                  }
                });
              }
            }
          });
        }

        if (navigator.geolocation) {
          if (watchId) navigator.geolocation.clearWatch(watchId);
          
          navigator.geolocation.getCurrentPosition(function(pos) {
            var coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            liveMap.setCenter(coords);
            liveMarker.setPosition(coords);
            findNearby(coords);
          });

          watchId = navigator.geolocation.watchPosition(function (pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            var coords = { lat: lat, lng: lng };
            if (liveMarker) liveMarker.setPosition(coords);
            
            var dashCoords = document.getElementById('dash-coords');
            if (dashCoords) dashCoords.textContent = 'Coordinate: ' + lat.toFixed(6) + ', ' + lng.toFixed(6);

            geocoder.geocode({ location: coords }, function (results, status) {
              if (status === 'OK' && results[0]) {
                var addr = results[0].formatted_address;
                var dashAddr = document.getElementById('dash-address');
                if (dashAddr) dashAddr.textContent = addr;
                if (!window._lastGpsSync || Date.now() - window._lastGpsSync > 30000) {
                  window._lastGpsSync = Date.now();
                  syncGpsToDB(lat, lng, addr);
                }
              }
            });
          }, null, { enableHighAccuracy: true });
        }
      }

      function syncGpsToDB(lat, lng, addr) {
        // Use a default patient or current patient if selected
        var pid = _curPat ? (_curPat.patientId || _curPat.id) : 'PT-0001';
        var sess = DB.get('session');
        if (!sess) return;
        var apiBase = window.location.port === '5500' ? 'http://localhost:5000' : '';
        fetch(apiBase + '/api/patients/' + pid + '/location', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (sess.token || '') },
          body: JSON.stringify({ lat: lat, lng: lng, address: addr })
        }).then(function() {
          console.log("GPS Synced with MongoDB");
        }).catch(function(e) {
          console.error("GPS Sync Failed", e);
        });
      }

      function goSec(id) {
        document.querySelectorAll('.sec').forEach(function (s) { s.classList.remove('active'); });
        var sec = document.getElementById('sec-' + id); if (sec) sec.classList.add('active');
        document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
        var ni = document.getElementById('nav-' + id); if (ni) ni.classList.add('active');
        var tt = secTitles[id] || ['Page', ''];
        var t1 = document.getElementById('ttitle'); if (t1) t1.textContent = tt[0];
        var t2 = document.getElementById('tsub'); if (t2) t2.textContent = tt[1];
        if (id === 'patients') renderPatients();
        if (id === 'search') renderSearch('');
        if (id === 'audit') renderAudit();
        if (id === 'reports') { renderPrintTable(); updateCounts(); }
        if (id === 'settings') updateCounts();
        if (id === 'gps') initLiveGPS();
        if (window.innerWidth <= 900) { var sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open'); }
        addAudit('Navigate', tt[0], 'OK');
      }

      // -- APP INIT ------------------------------------------------------
      function initApp() {
        renderPatients(); renderSearch(''); renderAudit(); renderPrintTable(); updateCounts();
        var dash = document.getElementById('sec-dashboard'); if (dash && !dash.classList.contains('active')) dash.classList.add('active');
        var ni = document.getElementById('nav-dashboard'); if (ni) ni.classList.add('active');
      }

      function updateCounts() {
        var pts = getPatients(), logs = getAudit();
        var m = { 'sv-pat': pts.length, 'sv-records': pts.length, 'rs-p': pts.length, 'rs-ev': logs.length, 'sp-cnt': pts.length, 'sp-audit': logs.length };
        Object.keys(m).forEach(function (id) { var el = document.getElementById(id); if (el) el.textContent = m[id]; });
      }

      // -- PATIENTS ------------------------------------------------------
      function sC(s) { return { critical: 'tag-critical', severe: 'tag-critical', moderate: 'tag-moderate', mild: 'tag-stable' }[s] || 'tag-info'; }
      function sP(s) { return { critical: 95, severe: 80, moderate: 55, mild: 25 }[s] || 40; }
      function sV(s) { return { critical: 'var(--danger)', severe: 'var(--danger)', moderate: 'var(--warn)', mild: 'var(--accent3)' }[s] || 'var(--accent)'; }

      function renderPatients() {
        var grid = document.getElementById('pat-grid'); if (!grid) return;
        var pts = getPatients();
        if (!pts.length) { grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3);grid-column:1/-1">No patients yet. Click <strong>Register Patient</strong> to add one.</div>'; return; }
        grid.innerHTML = pts.map(function (p) {
          var ini = (p.name || '?').split(' ').map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
          var d2 = (p.diagnosis || '').split(' ').slice(0, 3).join(' ');
          var pid = p.patientId || p.id;
          return '<div class="pat-card" data-pid="' + pid + '">'
            + '<div class="pat-top"><div class="pat-av">' + ini + '</div>'
            + '<div><div class="pat-name">' + p.name + '</div><div class="pat-id">' + pid + '</div>'
            + '<div style="font-size:.7rem;color:var(--text2);margin-top:2px">' + (p.dob || '-') + ' &middot; ' + (p.gender || '-') + ' &middot; ' + (p.blood || '-') + '</div></div></div>'
            + '<div class="pat-tags"><span class="tag ' + sC(p.severity) + '">' + (p.severity || '-') + '</span><span class="tag tag-info">' + d2 + '</span></div>'
            + '<div class="pat-meta"><span>' + (p.phone || '-') + '</span><span>' + (p.ecName || '-') + '</span></div>'
            + '<div class="sev-bar"><div class="sev-fill" style="width:' + sP(p.severity) + '%;background:' + sV(p.severity) + '"></div></div>'
            + '<div class="pat-actions">'
            + '<button class="btn btn-sm btn-outline" style="flex:1" data-action="view" data-pid="' + pid + '">View</button>'
            + '<button class="btn btn-sm btn-pdf" data-action="pdf" data-pid="' + pid + '">PDF</button>'
            + '<button class="btn btn-sm" style="background:rgba(0,232,150,.1);border:1px solid rgba(0,232,150,.25);color:var(--accent3);width:auto;padding:7px 9px;font-size:.73rem;border-radius:7px" data-action="print" data-pid="' + pid + '">Print</button>'
            + '</div></div>';
        }).join('');
        updateCounts();
      }

      var _curPat = null;
      function openPatient(id) {
        var pts = getPatients(); var p = pts.find(function (x) { return (x.patientId || x.id) === id; }); if (!p) { toast('error', 'Patient not found'); return; }
        _curPat = p; addAudit('View Record', p.patientId || p.id, 'OK');
        function ir(k, v) { return '<div class="ir"><div class="ik">' + k + '</div><div class="iv">' + (v || '-') + '</div></div>'; }
        var ini = (p.name || '?').split(' ').map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
        var pid = p.patientId || p.id;
        document.getElementById('patMB').innerHTML =
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;padding:13px;background:var(--surface2);border-radius:11px;border:1px solid var(--border)">'
          + '<div class="pat-av" style="width:52px;height:52px;font-size:1.1rem;border-radius:13px">' + ini + '</div>'
          + '<div><div style="font-size:1.05rem;font-weight:800">' + p.name + '</div>'
          + '<div style="font-family:var(--mono);font-size:.68rem;color:var(--text3)">' + pid + '</div>'
          + '<div style="margin-top:6px;display:flex;gap:4px"><span class="tag ' + sC(p.severity) + '">' + p.severity + '</span><span class="tag tag-info">' + p.diagnosis + '</span></div></div></div>'
          + '<div class="sec-div">Personal</div>'
          + ir('DOB', p.dob) + ir('Gender', p.gender) + ir('Blood', '<strong>' + (p.blood || '-') + '</strong>') + ir('Address', p.address) + ir('Phone', p.phone) + ir('Aadhaar/ID', p.aadhar)
          + '<div class="sec-div" style="margin-top:15px">Medical</div>'
          + ir('Diagnosis', '<strong>' + (p.diagnosis || '-') + '</strong>') + ir('Severity', '<span class="tag ' + sC(p.severity) + '">' + (p.severity || '-') + '</span>') + ir('Onset', p.onset)
          + ir('Allergies', '<span style="color:var(--danger)">! ' + (p.allergies || 'None') + '</span>') + ir('Medications', p.medications) + ir('History', p.history) + ir('Caregiver Notes', '<span style="color:var(--warn)">' + (p.notes || '-') + '</span>')
          + '<div class="sec-div" style="margin-top:15px">Emergency Contact</div>'
          + ir('Contact', '<strong>' + (p.ecName || '-') + '</strong> (' + (p.ecRel || '-') + ')') + ir('Primary Phone', '<a href="tel:' + (p.ec1 || '') + '" style="color:var(--accent)">P: ' + (p.ec1 || '-') + '</a>') + (p.ec2 ? ir('Alt Phone', 'P: ' + p.ec2) : '');
        document.getElementById('patModal').classList.remove('hidden');
      }

      function closeModal() { document.getElementById('patModal').classList.add('hidden'); }

      function savePatient() {
        var name = (document.getElementById('pn').value || '').trim();
        var dob = (document.getElementById('pd').value || '');
        if (!name || !dob) { toast('error', 'Name & Date of Birth are required'); return; }
        var pts = getPatients(), pNum = pts.length + 1, pid = 'PT-' + String(pNum).padStart(4, '0');
        while (pts.find(function (x) { return x.patientId === pid; })) { pNum++; pid = 'PT-' + String(pNum).padStart(4, '0'); }
        var np = {
          patientId: pid, id: pid, name: name, dob: dob,
          gender: document.getElementById('pg').value, blood: document.getElementById('pb').value,
          address: (document.getElementById('pa').value || '').trim(), phone: (document.getElementById('pp').value || '').trim(),
          aadhar: (document.getElementById('pid2').value || '').trim(), diagnosis: (document.getElementById('pdiag').value || '').trim(),
          severity: document.getElementById('psev').value, onset: (document.getElementById('pon').value || ''),
          allergies: (document.getElementById('pal').value || '').trim(), medications: (document.getElementById('pmed').value || '').trim(),
          history: (document.getElementById('phist').value || '').trim(), notes: (document.getElementById('pnotes').value || '').trim(),
          ecName: (document.getElementById('ecn').value || '').trim(), ecRel: (document.getElementById('ecr').value || '').trim(),
          ec1: (document.getElementById('ec1').value || '').trim(), ec2: (document.getElementById('ec2').value || '').trim(),
          createdAt: new Date().toISOString(), createdBy: CU ? CU.name : 'Staff'
        };
        pts.push(np); savePats(pts);
        addAudit('Register Patient', pid + ' - ' + name, 'OK');
        toast('success', name + ' registered as ' + pid);
        clearPF(); goSec('patients');
      }

      function clearPF() {
        ['pn', 'pa', 'pp', 'pid2', 'pal', 'pmed', 'phist', 'pnotes', 'ecn', 'ecr', 'ec1', 'ec2'].forEach(function (id) { var e = document.getElementById(id); if (e) e.value = ''; });
        var pd = document.getElementById('pd'); if (pd) pd.value = '';
        var po = document.getElementById('pon'); if (po) po.value = '';
      }

      function deletePatient(id) {
        if (!confirm('Delete this patient? Cannot be undone.')) return;
        savePats(getPatients().filter(function (p) { return (p.patientId || p.id) !== id; }));
        addAudit('Delete Patient', id, 'DELETED');
        toast('success', 'Patient deleted'); closeModal(); renderPatients();
      }

      function renderSearch(q) {
        var srb = document.getElementById('srb'); if (!srb) return;
        var pts = getPatients();
        if (q) { var ql = q.toLowerCase(); pts = pts.filter(function (p) { return (p.name || '').toLowerCase().includes(ql) || (p.patientId || '').toLowerCase().includes(ql) || (p.diagnosis || '').toLowerCase().includes(ql) || (p.blood || '').toLowerCase().includes(ql) || (p.severity || '').toLowerCase().includes(ql); }); }
        var src = document.getElementById('src'); if (src) src.textContent = pts.length + ' record(s)';
        if (!pts.length) { srb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:18px">No records found</td></tr>'; return; }
        srb.innerHTML = pts.map(function (p) {
          var pid = p.patientId || p.id;
          return '<tr><td style="font-family:var(--mono);font-size:.7rem">' + pid + '</td><td><strong>' + p.name + '</strong></td><td>' + (p.diagnosis || '-') + '</td><td><span class="tag ' + sC(p.severity) + '">' + (p.severity || '-') + '</span></td><td>' + (p.blood || '-') + '</td><td>' + (p.ecName || '-') + '</td>'
            + '<td style="display:flex;gap:5px"><button class="btn btn-sm btn-outline" data-action="view" data-pid="' + pid + '">View</button><button class="btn btn-sm btn-pdf" data-action="pdf" data-pid="' + pid + '">&#x1F4C4;</button></td></tr>';
        }).join('');
      }

      function renderAudit() {
        var ab = document.getElementById('auditb'); if (!ab) return;
        var logs = getAudit();
        if (!logs.length) { ab.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:18px">No logs yet</td></tr>'; return; }
        ab.innerHTML = logs.slice(0, 100).map(function (l) {
          return '<tr><td style="font-family:var(--mono);font-size:.66rem">' + new Date(l.timestamp).toLocaleString() + '</td><td>' + (l.user || '-') + '</td><td><span class="chip" style="padding:2px 6px">' + (l.role || '-') + '</span></td><td>' + (l.action || '-') + '</td><td style="color:var(--text2)">' + (l.target || '-') + '</td><td>' + (l.status || '-') + '</td></tr>';
        }).join('');
        updateCounts();
      }

      function renderPrintTable() {
        var ptb = document.getElementById('ptb'); if (!ptb) return;
        var pts = getPatients();
        if (!pts.length) { ptb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:16px">No patients registered yet</td></tr>'; return; }
        ptb.innerHTML = pts.map(function (p) {
          var pid = p.patientId || p.id;
          return '<tr><td style="font-family:var(--mono);font-size:.7rem">' + pid + '</td><td><strong>' + p.name + '</strong></td><td>' + (p.diagnosis || '-') + '</td><td><span class="tag ' + sC(p.severity) + '">' + (p.severity || '-') + '</span></td>'
            + '<td style="display:flex;gap:6px"><button class="btn btn-sm btn-pdf-all" data-action="pdf" data-pid="' + pid + '">&#x1F4C4; PDF</button><button class="btn btn-sm btn-outline" data-action="print" data-pid="' + pid + '">&#x1F5A8; Print</button></td></tr>';
        }).join('');
        updateCounts();
      }

      function refreshVitals() {
        var hr = Math.floor(Math.random() * 30 + 70), sys = Math.floor(Math.random() * 30 + 118), dia = Math.floor(Math.random() * 20 + 74);
        var spo = Math.floor(Math.random() * 4 + 95), temp = (36.4 + Math.random() * 1.2).toFixed(1);
        var m = { vhr: hr, vbp: sys + '/' + dia, vspo: spo, vtemp: temp };
        Object.keys(m).forEach(function (id) { var e = document.getElementById(id); if (e) e.textContent = m[id]; });
        toast('info', 'Vitals refreshed');
      }

      function triggerEmergency() {
        var eb = document.getElementById('embanner'); if (eb) eb.style.display = 'flex';
        toast('error', 'EMERGENCY ALERT - Caregivers notified');
        addAudit('Emergency Alert', 'Crisis', 'ALERT');
      }

      // -- PDF ENGINE ----------------------------------------------------
      function pdfProg(show, title, sub, pct) {
        var ov = document.getElementById('pdfOv'); if (!ov) return;
        if (!show) { setTimeout(function () { ov.classList.remove('show'); }, 300); return; }
        var t = document.getElementById('pdfT'); if (t) t.textContent = title || 'Generating...';
        var s = document.getElementById('pdfS'); if (s) s.textContent = sub || 'Please wait';
        var b = document.getElementById('pdfPB'); if (b) b.style.width = (pct || 0) + '%';
        ov.classList.add('show');
      }

      function checkJ() { return !!(window.jspdf && window.jspdf.jsPDF) || (toast('error', 'PDF library not loaded yet. Wait a moment and retry.'), false); }
      function savePDF(doc, fn) { try { doc.save(fn); } catch (e) { toast('error', 'PDF save failed.'); } }

      function pH(doc, title, sub) {
        var W = doc.internal.pageSize.getWidth();
        doc.setFillColor(8, 15, 30); doc.rect(0, 0, W, 44, 'F'); doc.setFillColor(0, 180, 255); doc.rect(0, 0, W, 2, 'F');
        doc.setFillColor(0, 102, 204); doc.roundedRect(13, 8, 27, 27, 3, 3, 'F');
        doc.setTextColor(255, 255, 255); doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text('NR', 26.5, 25, { align: 'center' });
        doc.setTextColor(221, 238, 255); doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text('NeuroRecall Monitor', 46, 18);
        doc.setTextColor(61, 96, 128); doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.text('CRISIS MEMORY LOSS TRACKER | CONFIDENTIAL', 46, 26);
        doc.setTextColor(221, 238, 255); doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text(String(title || ''), W - 13, 18, { align: 'right' });
        doc.setTextColor(122, 160, 196); doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.text(String(sub || ''), W - 13, 26, { align: 'right' });
        doc.setDrawColor(0, 102, 204); doc.setLineWidth(0.3); doc.line(0, 44, W, 44); return 52;
      }

      function pF(doc, by) {
        var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), n = doc.internal.getNumberOfPages();
        for (var i = 1; i <= n; i++) {
          doc.setPage(i); doc.setFillColor(8, 15, 30); doc.rect(0, H - 13, W, 13, 'F');
          doc.setDrawColor(61, 96, 128); doc.setLineWidth(0.2); doc.line(0, H - 13, W, H - 13);
          doc.setTextColor(61, 96, 128); doc.setFontSize(6.5); doc.setFont('helvetica', 'normal');
          doc.text('Generated by: ' + (by || 'NeuroRecall') + '  |  ' + new Date().toLocaleString() + '  |  CONFIDENTIAL', 13, H - 4.5);
          doc.text('Page ' + i + ' of ' + n, W - 13, H - 4.5, { align: 'right' });
        }
      }

      function pSH(doc, txt, y) {
        var W = doc.internal.pageSize.getWidth();
        doc.setFillColor(12, 22, 40); doc.roundedRect(13, y, W - 26, 9, 1, 1, 'F'); doc.setFillColor(0, 180, 255); doc.rect(13, y, 3, 9, 'F');
        doc.setTextColor(0, 180, 255); doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.text(String(txt || '').toUpperCase(), 20, y + 6.3);
        return y + 14;
      }

      function pR(doc, key, val, y, shade) {
        var W = doc.internal.pageSize.getWidth();
        if (shade) { doc.setFillColor(10, 20, 36); doc.rect(13, y, W - 26, 8.5, 'F'); }
        doc.setTextColor(61, 96, 128); doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.text(String(key || ''), 17, y + 5.8);
        doc.setTextColor(221, 238, 255); doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');
        var lines = doc.splitTextToSize(String(val || '-'), W - 100); doc.text(lines[0] || '-', 88, y + 5.8);
        doc.setDrawColor(20, 38, 65); doc.setLineWidth(0.2); doc.line(13, y + 8.5, W - 13, y + 8.5); return y + 9;
      }

      function buildPDF(p) {
        if (!checkJ()) return null;
        var J = window.jspdf.jsPDF, doc = new J({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        var W = doc.internal.pageSize.getWidth(), pid = String(p.patientId || p.id || '-');
        var sR = { critical: [255, 61, 107], severe: [255, 61, 107], moderate: [255, 170, 51], mild: [0, 232, 150] };
        var sc = sR[p.severity] || [0, 180, 255];
        var y = pH(doc, 'Patient Medical Record', 'ID: ' + pid);
        doc.setFillColor(8, 15, 30); doc.roundedRect(13, y, W - 26, 38, 3, 3, 'F');
        doc.setDrawColor(sc[0], sc[1], sc[2]); doc.setLineWidth(0.6); doc.roundedRect(13, y, W - 26, 38, 3, 3, 'S');
        doc.setFillColor(0, 102, 204); doc.circle(28, y + 19, 10, 'F');
        var ini = (p.name || '?').split(' ').map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
        doc.setTextColor(255, 255, 255); doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.text(ini, 28, y + 22, { align: 'center' });
        doc.setTextColor(221, 238, 255); doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text(String(p.name || ''), 44, y + 14);
        doc.setTextColor(122, 160, 196); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
        doc.text(pid + ' | DOB: ' + (p.dob || '-') + ' | ' + (p.gender || '-') + ' | Blood: ' + (p.blood || '-'), 44, y + 22);
        doc.text('Phone: ' + (p.phone || '-') + ' ID: ' + (p.aadhar || '-'), 44, y + 30);
        doc.setFillColor(sc[0], sc[1], sc[2]); doc.roundedRect(W - 50, y + 8, 34, 10, 2, 2, 'F');
        doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.text((p.severity || '').toUpperCase(), W - 33, y + 14.5, { align: 'center' });
        y += 46;
        y = pSH(doc, 'Personal Information', y); var sh = false;
        [['Full Name', p.name], ['DOB', p.dob], ['Gender', p.gender], ['Blood', p.blood], ['Address', p.address], ['Phone', p.phone], ['Aadhaar/ID', p.aadhar]].forEach(function (r) { y = pR(doc, r[0], r[1], y, sh); sh = !sh; });
        y += 6; y = pSH(doc, 'Medical Information', y); sh = false;
        [['Diagnosis', p.diagnosis], ['Severity', (p.severity || '').toUpperCase()], ['Onset', p.onset], ['Allergies', p.allergies || 'None'], ['Medications', p.medications], ['History', p.history]].forEach(function (r) { y = pR(doc, r[0], r[1], y, sh); sh = !sh; });
        y += 6;
        if (p.notes) { doc.setFillColor(20, 30, 50); doc.roundedRect(13, y, W - 26, 22, 2, 2, 'F'); doc.setTextColor(255, 170, 51); doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.text('CAREGIVER NOTES', 17, y + 8); doc.setTextColor(221, 238, 255); doc.setFontSize(8); doc.setFont('helvetica', 'normal'); var nl = doc.splitTextToSize(String(p.notes), W - 34); doc.text(nl.slice(0, 2), 17, y + 15); y += 28; }
        if (y > 230) { doc.addPage(); y = pH(doc, 'Patient Record (cont.)', 'ID: ' + pid); }
        y = pSH(doc, 'Emergency Contact', y);
        doc.setFillColor(38, 5, 14); doc.roundedRect(13, y, W - 26, 36, 2, 2, 'F'); doc.setDrawColor(255, 61, 107); doc.setLineWidth(0.4); doc.roundedRect(13, y, W - 26, 36, 2, 2, 'S');
        doc.setTextColor(255, 61, 107); doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.text('IN CASE OF EMERGENCY:', 17, y + 9);
        doc.setTextColor(221, 238, 255); doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text(String(p.ecName || '-'), 17, y + 19);
        doc.setTextColor(122, 160, 196); doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.text('Relationship: ' + (p.ecRel || '-'), 17, y + 27);
        doc.setTextColor(0, 180, 255); doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text((p.ec1 || '-') + (p.ec2 ? ' | ' + p.ec2 : ''), 17, y + 34);
        pF(doc, CU ? CU.name : 'NeuroRecall Staff'); return doc;
      }

      function dlPatientPDF(id) {
        if (!checkJ()) return;
        var pts = getPatients(); var p = pts.find(function (x) { return (x.patientId || x.id) === id; }); if (!p) { toast('error', 'Patient not found'); return; }
        pdfProg(true, 'Generating PDF...', 'Building: ' + p.name, 50);
        setTimeout(function () {
          try { 
            var doc = buildPDF(p); 
            if (!doc) { pdfProg(false); return; } 
            var patientId = p.patientId || p.id;
            savePDF(doc, 'NeuroRecall_' + patientId + '_' + p.name.replace(/\s+/g, '_') + '.pdf'); 
            addAudit('PDF Export', patientId, 'OK'); 
            pdfProg(false); 
            toast('success', 'PDF ready: ' + p.name); 
          }
          catch (e) { pdfProg(false); toast('error', 'PDF failed: ' + e.message); }
        }, 100);
      }

      function exportAllPDF() {
        if (!checkJ()) return;
        var pts = getPatients(); if (!pts.length) { toast('warn', 'No patients registered yet'); return; }
        pdfProg(true, 'All Patients Report...', 'Building', 20);
        setTimeout(function () {
          try {
            var J = window.jspdf.jsPDF, doc = new J({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            var W = doc.internal.pageSize.getWidth(), y = pH(doc, 'Complete Patient Registry', pts.length + ' patients | ' + new Date().toLocaleDateString());
            var crit = pts.filter(function (p) { return p.severity === 'critical' || p.severity === 'severe'; }).length;
            var mod = pts.filter(function (p) { return p.severity === 'moderate'; }).length;
            var mild = pts.filter(function (p) { return p.severity === 'mild'; }).length;
            var sW = (W - 28) / 3;
            [[String(crit), 'CRITICAL/SEVERE', [255, 61, 107]], [String(mod), 'MODERATE', [255, 170, 51]], [String(mild), 'MILD/STABLE', [0, 232, 150]]].forEach(function (item, i) {
              var sx = 14 + i * sW; doc.setFillColor(8, 15, 30); doc.roundedRect(sx + 2, y, sW - 4, 19, 2, 2, 'F');
              doc.setFillColor(item[2][0], item[2][1], item[2][2]); doc.rect(sx + 2, y, 3, 19, 'F');
              doc.setTextColor(item[2][0], item[2][1], item[2][2]); doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text(item[0], sx + 12, y + 12);
              doc.setTextColor(122, 160, 196); doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.text(item[1], sx + 12, y + 17);
            });
            y += 27;
            doc.autoTable({
              startY: y, head: [['Patient ID', 'Full Name', 'DOB', 'Gender', 'Blood', 'Diagnosis', 'Severity', 'Emergency Contact', 'Phone']],
              body: pts.map(function (p) { var d = String(p.diagnosis || ''); return [p.patientId || p.id || '-', p.name || '-', p.dob || '-', p.gender || '-', p.blood || '-', d.length > 24 ? d.slice(0, 24) + '...' : d, (p.severity || '').toUpperCase(), p.ecName || '-', p.ec1 || '-']; }),
              theme: 'plain', styles: { font: 'helvetica', fontSize: 8, cellPadding: 3.5, textColor: [221, 238, 255], fillColor: [8, 15, 30] },
              headStyles: { fillColor: [12, 22, 40], textColor: [0, 180, 255], fontStyle: 'bold', fontSize: 7.5 },
              alternateRowStyles: { fillColor: [10, 20, 35] }, margin: { left: 14, right: 14 }
            });
            pF(doc, CU ? CU.name : 'NeuroRecall Staff'); savePDF(doc, 'NeuroRecall_AllPatients_' + new Date().toISOString().slice(0, 10) + '.pdf');
            addAudit('PDF Export - All Patients', 'Reports', 'OK'); pdfProg(false); toast('success', 'All Patients PDF - ' + pts.length + ' records');
          } catch (e) { pdfProg(false); toast('error', 'PDF failed: ' + e.message); }
        }, 100);
      }

      function exportMedPDF() {
        if (!checkJ()) return;
        pdfProg(true, 'Medication Report...', 'Building', 20);
        setTimeout(function () {
          try {
            var pts = getPatients(), J = window.jspdf.jsPDF, doc = new J({ unit: 'mm', format: 'a4' });
            var W = doc.internal.pageSize.getWidth(), y = pH(doc, 'Medication Compliance Report', new Date().toLocaleDateString());
            y = pSH(doc, 'Active Medication Schedules', y);
            var rows = pts.filter(function (p) { return p.medications && p.medications.trim(); }).map(function (p) { var m = (p.medications || '').split(','); return [p.patientId || p.id || '-', p.name || '-', m[0] ? m[0].trim() : '-', 'As prescribed', 'Active', 'OK']; });
            if (!rows.length) rows.push(['-', 'No medication data', '-', '-', '-', '-']);
            doc.autoTable({
              startY: y, head: [['Patient ID', 'Name', 'Primary Medication', 'Frequency', 'Status', 'Notes']], body: rows, theme: 'plain',
              styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, textColor: [221, 238, 255], fillColor: [8, 15, 30] },
              headStyles: { fillColor: [12, 22, 40], textColor: [0, 180, 255], fontStyle: 'bold', fontSize: 8 },
              alternateRowStyles: { fillColor: [10, 20, 35] }, margin: { left: 13, right: 13 }
            });
            var fy = doc.lastAutoTable.finalY + 12;
            if (fy < doc.internal.pageSize.getHeight() - 30) {
              doc.setFillColor(35, 20, 5); doc.roundedRect(13, fy, W - 26, 18, 2, 2, 'F');
              doc.setTextColor(255, 170, 51); doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.text('Total: ' + pts.length + ' patients | With Medications: ' + rows.length + ' | ' + new Date().toLocaleString(), 18, fy + 11);
            }
            pF(doc, CU ? CU.name : 'NeuroRecall Staff'); savePDF(doc, 'NeuroRecall_MedReport_' + new Date().toISOString().slice(0, 10) + '.pdf');
            addAudit('PDF Export - Medications', 'Reports', 'OK'); pdfProg(false); toast('success', 'Medication Report downloaded');
          } catch (e) { pdfProg(false); toast('error', 'PDF failed: ' + e.message); }
        }, 100);
      }

      function exportCrisisPDF() {
        if (!checkJ()) return;
        pdfProg(true, 'Crisis Report...', 'Building', 20);
        setTimeout(function () {
          try {
            var logs = getAudit(), J = window.jspdf.jsPDF, doc = new J({ unit: 'mm', format: 'a4' });
            var W = doc.internal.pageSize.getWidth(), month = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
            var y = pH(doc, 'Crisis Incident Report', month);
            var ac = logs.filter(function (l) { return l.action && (l.action.indexOf('Emergency') > -1 || l.action.indexOf('Crisis') > -1); }).length;
            var kpis = [[String(ac), 'CRISIS ALERTS', [255, 61, 107]], [String(logs.length), 'TOTAL EVENTS', [255, 170, 51]], [String(ac || 0) + 'm', 'AVG RESPONSE', [0, 180, 255]], ['Active', 'SYSTEM STATUS', [0, 232, 150]]];
            var kW = (W - 28) / 4;
            kpis.forEach(function (item, i) { var sx = 14 + i * kW; doc.setFillColor(8, 15, 30); doc.roundedRect(sx + 1, y, kW - 2, 20, 2, 2, 'F'); doc.setFillColor(item[2][0], item[2][1], item[2][2]); doc.rect(sx + 1, y, 3, 20, 'F'); doc.setTextColor(item[2][0], item[2][1], item[2][2]); doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text(item[0], sx + 10, y + 13); doc.setTextColor(122, 160, 196); doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.text(item[1], sx + 10, y + 18); });
            y += 28; y = pSH(doc, 'Incident Log', y);
            var rows = logs.length ? logs.slice(0, 25).map(function (l) { return [new Date(l.timestamp).toLocaleString(), l.user || '-', l.role || '-', l.action || '-', l.target || '-', l.status || '-']; }) : [[new Date().toLocaleString(), 'System', 'system', 'No incidents', '-', '-']];
            doc.autoTable({
              startY: y, head: [['Timestamp', 'User', 'Role', 'Event', 'Record', 'Status']], body: rows, theme: 'plain',
              styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 3.5, textColor: [221, 238, 255], fillColor: [8, 15, 30] },
              headStyles: { fillColor: [35, 5, 14], textColor: [255, 100, 130], fontStyle: 'bold', fontSize: 7.5 },
              alternateRowStyles: { fillColor: [12, 18, 35] }, margin: { left: 13, right: 13 }
            });
            pF(doc, CU ? CU.name : 'NeuroRecall Staff'); savePDF(doc, 'NeuroRecall_CrisisReport_' + new Date().toISOString().slice(0, 10) + '.pdf');
            addAudit('PDF Export - Crisis', 'Reports', 'OK'); pdfProg(false); toast('success', 'Crisis Report downloaded');
          } catch (e) { pdfProg(false); toast('error', 'PDF failed: ' + e.message); }
        }, 100);
      }

      function exportAuditPDF() {
        if (!checkJ()) return;
        pdfProg(true, 'Audit Log PDF...', 'Building', 20);
        setTimeout(function () {
          try {
            var logs = getAudit(), J = window.jspdf.jsPDF, doc = new J({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            var W = doc.internal.pageSize.getWidth(), y = pH(doc, 'System Audit Log', 'Exported: ' + new Date().toLocaleString());
            var rows = logs.length ? logs.slice(0, 50).map(function (l) { return [new Date(l.timestamp).toLocaleString(), l.user || '-', l.role || '-', l.action || '-', l.target || '-', l.status || '-']; }) : [['-', '-', '-', 'No records', '-', '-']];
            doc.autoTable({
              startY: y, head: [['Timestamp', 'User', 'Role', 'Action', 'Record', 'Status']], body: rows, theme: 'plain',
              styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 3.5, textColor: [221, 238, 255], fillColor: [8, 15, 30] },
              headStyles: { fillColor: [5, 12, 28], textColor: [0, 180, 255], fontStyle: 'bold', fontSize: 7.5 },
              alternateRowStyles: { fillColor: [10, 18, 34] }, margin: { left: 13, right: 13 }
            });
            pF(doc, CU ? CU.name : 'NeuroRecall Staff'); savePDF(doc, 'NeuroRecall_AuditLog_' + new Date().toISOString().slice(0, 10) + '.pdf');
            addAudit('PDF Export - Audit Log', 'System', 'OK'); pdfProg(false); toast('success', 'Audit Log PDF downloaded');
          } catch (e) { pdfProg(false); toast('error', 'PDF failed: ' + e.message); }
        }, 100);
      }

      function printPatient() { if (_curPat) printCard(_curPat); else toast('error', 'No patient selected'); }
      function printPatientById(id) {
        var pts = getPatients(); var p = pts.find(function (x) { return (x.patientId || x.id) === id; }); if (!p) { toast('error', 'Patient not found'); return; }
        printCard(p);
      }
      function printCard(p) {
        var pid = String(p.patientId || p.id || '-');
        var sev = String(p.severity || 'unknown');
        var ini = (p.name || '?').split(' ').map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
        var regDate = new Date(p.createdAt || Date.now()).toLocaleDateString();
        var sn = CU ? CU.name : 'NeuroRecall Staff';
        var sc = { critical: '#ff3d6b', severe: '#ff3d6b', moderate: '#ffaa33', mild: '#00e896' }[sev] || '#00b4ff';
        var sbg = { critical: 'rgba(255,61,107,.15)', severe: 'rgba(255,61,107,.15)', moderate: 'rgba(255,170,51,.15)', mild: 'rgba(0,232,150,.1)' }[sev] || 'rgba(0,180,255,.1)';
        function row(k, v) { return '<div class="row"><div class="k">' + k + '</div><div class="v">' + (v || '-') + '</div></div>'; }
        var so = '<scr' + 'ipt>', sc2 = '</scr' + 'ipt>';
        var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + p.name + '</title>';
        html += '<style>body{font-family:Segoe UI,sans-serif;margin:0;font-size:13px}.hd{background:#020912;color:#ddeeff;padding:13px 20px;display:flex;align-items:center;gap:12px}';
        html += '.lb{width:38px;height:38px;background:linear-gradient(135deg,#0066cc,#00b4ff);border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#fff}';
        html += '.bn h1{margin:0;font-size:1rem;color:#ddeeff}.bn p{margin:0;font-size:.6rem;color:#3d6080}.hr{display:flex;align-items:center;gap:14px;padding:15px 20px;background:#080f1e;border-bottom:2px solid ' + sc + '}';
        html += '.av{width:46px;height:46px;border-radius:11px;background:linear-gradient(135deg,#0066cc,#00b4ff);display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:800;color:#fff;flex-shrink:0}';
        html += '.pn{font-size:1.1rem;font-weight:800;color:#ddeeff;margin-bottom:3px}.pm{font-size:.71rem;color:#7aa0c4;line-height:1.5}';
        html += '.sb{display:inline-block;padding:3px 10px;border-radius:100px;font-size:.68rem;font-weight:700;background:' + sbg + ';color:' + sc + ';border:1px solid ' + sc + ';margin-left:auto}';
        html += '.sc{padding:13px 20px;border-bottom:1px solid #e8edf2}.sh{font-size:.66rem;font-weight:700;color:#3d6080;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px;padding-bottom:5px;border-bottom:2px solid ' + sc + '}';
        html += '.row{display:flex;padding:5px 0;border-bottom:1px solid #f0f3f7}.row:last-child{border-bottom:none}.k{font-size:.68rem;color:#666;min-width:145px;font-weight:600}.v{font-size:.79rem;color:#111;flex:1}';
        html += '.em{background:#fff8f8;border:2px solid #ff3d6b;border-radius:9px;margin:13px 20px;padding:13px}.em-t{font-size:.7rem;font-weight:800;color:#ff3d6b;letter-spacing:.07em;margin-bottom:8px}.em-ph{font-size:1rem;font-weight:700;color:#c0002a}';
        html += '.ft{display:flex;justify-content:space-between;padding:10px 20px;background:#f7f9fb;font-size:.65rem;color:#888;border-top:1px solid #ddd}@media print{@page{margin:10mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>';
        html += '<div class="hd"><div class="lb">NR</div><div class="bn"><h1>NeuroRecall Monitor</h1><p>Patient Medical Record &middot; Confidential</p></div></div>';
        html += '<div class="hr"><div class="av">' + ini + '</div><div><div class="pn">' + p.name + '</div><div class="pm">ID: <strong>' + pid + '</strong> &nbsp;|&nbsp; DOB: ' + (p.dob || '-') + ' &nbsp;|&nbsp; ' + (p.gender || '-') + ' &nbsp;|&nbsp; Blood: <strong>' + (p.blood || '-') + '</strong><br>Phone: ' + (p.phone || '-') + '&nbsp;|&nbsp; Reg: ' + regDate + '</div></div><span class="sb">' + sev.toUpperCase() + '</span></div>';
        html += '<div class="sc"><div class="sh">Personal</div>' + row('Full Name', '<strong>' + p.name + '</strong>') + row('DOB', p.dob) + row('Gender', p.gender) + row('Blood', '<strong>' + p.blood + '</strong>') + row('Address', p.address) + row('Phone', p.phone) + row('Aadhaar/ID', p.aadhar) + '</div>';
        html += '<div class="sc"><div class="sh">Medical</div>' + row('Diagnosis', '<strong>' + (p.diagnosis || '-') + '</strong>') + row('Severity', sev.toUpperCase()) + row('Onset', p.onset) + row('Allergies', '<span style="color:#c9184a">! ' + (p.allergies || 'None') + '</span>') + row('Medications', p.medications) + row('History', p.history) + row('Notes', '<span style="color:#b87800">' + (p.notes || '-') + '</span>') + '</div>';
        html += '<div class="em"><div class="em-t">EMERGENCY CONTACT</div>' + row('Contact', '<strong>' + (p.ecName || '-') + '</strong> (' + (p.ecRel || '-') + ')') + '<div class="row"><div class="k">Primary Phone</div><div class="v em-ph">' + (p.ec1 || '-') + '</div></div>' + (p.ec2 ? row('Alt Phone', p.ec2) : '') + '</div>';
        html += '<div class="ft"><span>Printed by: ' + sn + ' | ' + new Date().toLocaleString() + '</span><span>CONFIDENTIAL</span></div>';
        html += so + 'window.onload = function() { setTimeout(function() { window.print(); }, 500); };' + sc2;
        html += '</body></html>';
        var popup = window.open('', '_blank', 'width=800,height=1060');
        if (!popup) { toast('error', 'Popup blocked - allow popups'); return; }
        popup.document.write(html);
        popup.document.close();
        addAudit('Print Card', pid, 'SUCCESS');
      }

      // ==================================================================
      // EVENT WIRING - all done here, no onclick in HTML anywhere
      // ==================================================================
      function on(id, evt, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(evt, fn);
      }
      function onAll(sel, evt, fn) {
        document.querySelectorAll(sel).forEach(function (el) { el.addEventListener(evt, fn); });
      }

      // AUTH TABS
      on('tab-login', 'click', function () { switchTab('login'); });
      on('tab-register', 'click', function () { switchTab('register'); });
      on('tab-forgot', 'click', function () { switchTab('forgot'); });

      // LOGIN
      on('btn-login1', 'click', loginStep1);
      on('btn-login2', 'click', loginStep2);
      on('btn-back-l', 'click', function () { gotoStep('login', 'login-s1'); });
      on('btn-resend-l', 'click', function () { resendOTP('l'); });

      // REGISTER
      on('btn-reg1', 'click', regStep1);
      on('btn-reg2', 'click', regStep2);
      on('btn-back-r', 'click', function () { gotoStep('register', 'reg-s1'); });
      on('btn-resend-r', 'click', function () { resendOTP('r'); });

      // FORGOT
      on('btn-fp1', 'click', fpStep1);
      on('btn-fp2', 'click', fpStep2);
      on('btn-fp3', 'click', fpStep3);
      on('btn-resend-fp', 'click', function () { resendOTP('fp'); });
      on('btn-back-fp', 'click', function () { switchTab('login'); });
      on('btn-go-login', 'click', function () { switchTab('login'); });

      // PASSWORD STRENGTH
      on('r-pass', 'input', function () { checkPW(this.value, 'pw-bar', 'pw-hint'); });
      on('fp-np', 'input', function () { checkPW(this.value, 'fp-pw-bar', ''); });

      // SIDEBAR NAV
      on('nav-dashboard', 'click', function () { goSec('dashboard'); });
      on('nav-alerts', 'click', function () { goSec('alerts'); });
      on('nav-patients', 'click', function () { goSec('patients'); });
      on('nav-addpat', 'click', function () { goSec('addpat'); });
      on('nav-search', 'click', function () { goSec('search'); });
      on('nav-meds', 'click', function () { goSec('meds'); });
      on('nav-vitals', 'click', function () { goSec('vitals'); });
      on('nav-history', 'click', function () { goSec('history'); });
      on('nav-reports', 'click', function () { goSec('reports'); });
      on('nav-audit', 'click', function () { goSec('audit'); });
      on('nav-settings', 'click', function () { goSec('settings'); });
      on('nav-gps', 'click', function () { goSec('gps'); });
      on('nav-logout', 'click', doLogout);

      // TOPBAR
      on('btn-sidebar', 'click', function () { var sb = document.getElementById('sidebar'); if (sb) sb.classList.toggle('open'); });
      on('btn-emergency', 'click', triggerEmergency);
      on('btn-dismiss-banner', 'click', function () { document.getElementById('embanner').style.display = 'none'; });

      // DASHBOARD QUICK ACTIONS
      on('btn-view-alerts', 'click', function () { goSec('alerts'); });
      on('btn-all-patients', 'click', function () { goSec('patients'); });
      on('qa-addpat', 'click', function () { goSec('addpat'); });
      on('qa-emergency', 'click', triggerEmergency);
      on('qa-search', 'click', function () { goSec('search'); });
      on('qa-reports', 'click', function () { goSec('reports'); });

      // ALERTS
      on('btn-raise-alert', 'click', triggerEmergency);
      on('btn-respond', 'click', function () { toast('success', 'Caregiver dispatched'); });
      on('btn-mark-done', 'click', function () { toast('success', 'Marked as administered'); });

      // PATIENT SECTION
      on('btn-new-patient', 'click', function () { goSec('addpat'); });
      on('btn-save-patient', 'click', savePatient);
      on('btn-clear-patient', 'click', clearPF);

      // SEARCH
      on('si', 'input', function () { renderSearch(this.value); });
      on('qs-critical', 'click', function () { document.getElementById('si').value = 'critical'; renderSearch('critical'); });
      on('qs-alzheimer', 'click', function () { document.getElementById('si').value = 'Alzheimer'; renderSearch('Alzheimer'); });
      on('qs-dementia', 'click', function () { document.getElementById('si').value = 'Dementia'; renderSearch('Dementia'); });
      on('qs-blood', 'click', function () { document.getElementById('si').value = 'O+'; renderSearch('O+'); });

      // MEDS
      on('btn-add-sched', 'click', function () { toast('success', 'Schedule updated'); });
      on('btn-mark1', 'click', function () { toast('success', 'Marked given'); });
      on('btn-administer', 'click', function () { toast('success', 'Administered & logged'); });
      on('btn-mark2', 'click', function () { toast('success', 'Marked given'); });

      // VITALS
      on('btn-refresh-vitals', 'click', refreshVitals);

      // HISTORY
      on('btn-save-note', 'click', function () { toast('success', 'Note saved'); });

      // REPORTS & PDFs
      on('btn-pdf-all', 'click', exportAllPDF);
      on('btn-pdf-med', 'click', exportMedPDF);
      on('btn-pdf-crisis', 'click', exportCrisisPDF);
      on('btn-pdf-audit', 'click', exportAuditPDF);
      on('rc-all', 'click', exportAllPDF);
      on('rc-med', 'click', exportMedPDF);
      on('rc-crisis', 'click', exportCrisisPDF);

      // MODAL
      on('btn-close-modal', 'click', closeModal);
      on('btn-close-modal2', 'click', closeModal);
      on('btn-alert-patient', 'click', function () { toast('success', 'Alert raised'); closeModal(); });
      on('btn-pdf-patient', 'click', function () { if (_curPat) dlPatientPDF(_curPat.patientId || _curPat.id); });
      on('btn-print-patient', 'click', printPatient);
      on('patModal', 'click', function (e) { if (e.target === this) closeModal(); });

      // SETTINGS
      on('btn-save-settings', 'click', function () { toast('success', 'Settings saved'); });
      on('toggle-crisis', 'click', function () { toast('info', 'Setting saved'); });
      on('toggle-meds', 'click', function () { toast('info', 'Setting saved'); });

      // DELEGATED: pat-grid (patient cards, view/pdf/print buttons)
      on('pat-grid', 'click', function (e) {
        var btn = e.target.closest('[data-action]');
        var card = e.target.closest('.pat-card');
        if (btn) {
          e.stopPropagation();
          var action = btn.getAttribute('data-action'), pid = btn.getAttribute('data-pid');
          if (action === 'view') openPatient(pid);
          else if (action === 'pdf') dlPatientPDF(pid);
          else if (action === 'print') printPatientById(pid);
        } else if (card) {
          openPatient(card.getAttribute('data-pid'));
        }
      });

      // DELEGATED: search results
      on('srb', 'click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (btn) {
          var action = btn.getAttribute('data-action'), pid = btn.getAttribute('data-pid');
          if (action === 'view') openPatient(pid);
          else if (action === 'pdf') dlPatientPDF(pid);
        }
      });

      // DELEGATED: print table
      on('ptb', 'click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (btn) {
          var action = btn.getAttribute('data-action'), pid = btn.getAttribute('data-pid');
          if (action === 'pdf') dlPatientPDF(pid);
          else if (action === 'print') printPatientById(pid);
        }
      });

      // OTP box navigation
      wireOTPBoxes('l'); wireOTPBoxes('r'); wireOTPBoxes('fp');

      // ENTER key on auth forms
      on('l-pass', 'keydown', function (e) { if (e.key === 'Enter') loginStep1(); });
      on('l-email', 'keydown', function (e) { if (e.key === 'Enter') loginStep1(); });
      on('r-pass2', 'keydown', function (e) { if (e.key === 'Enter') regStep1(); });
      on('fp-email', 'keydown', function (e) { if (e.key === 'Enter') fpStep1(); });
      on('fp-np2', 'keydown', function (e) { if (e.key === 'Enter') fpStep3(); });

      // PARTICLE CANVAS (auth background)
      (function () {
        var canvas = document.getElementById('auth-canvas'); if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var W = canvas.width = window.innerWidth, H = canvas.height = window.innerHeight;
        window.addEventListener('resize', function () { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; });
        var P = []; for (var i = 0; i < 50; i++)P.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4, r: Math.random() * 1.4 + .4, a: Math.random() * .35 + .08 });
        function draw() {
          ctx.clearRect(0, 0, W, H);
          P.forEach(function (p) { p.x += p.vx; p.y += p.vy; if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,150,255,' + p.a + ')'; ctx.fill(); });
          for (var i = 0; i < P.length; i++)for (var j = i + 1; j < P.length; j++) { var dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, d = Math.sqrt(dx * dx + dy * dy); if (d < 100) { ctx.beginPath(); ctx.moveTo(P[i].x, P[i].y); ctx.lineTo(P[j].x, P[j].y); ctx.strokeStyle = 'rgba(0,150,255,' + (0.1 * (1 - d / 100)) + ')'; ctx.lineWidth = 0.5; ctx.stroke(); } }
          requestAnimationFrame(draw);
        }
        draw();
      })();

      // SESSION RESTORE (zero network calls)
      (function () {
        try {
          var sess = DB.get('session');
          if (!sess || !sess.userId) return;
          if (Date.now() - (sess.loginTime || 0) > 28800000) { DB.del('session'); return; }
          var users = getUsers();
          var user = users.find(function (u) { return u.id === sess.userId; });
          if (user) { CU = user; launchApp(user); }
          else DB.del('session');
        } catch (e) { }
      })();

    // INIT AUTH SCREEN
    switchTab('login');
  