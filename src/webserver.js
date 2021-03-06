import express from "express";
import _ from "underscore";
import db_session from "./database";
import bodyParser from "body-parser";
import jwt from "jsonwebtoken";
import passport from "passport";
import passportJWT from "passport-jwt";
import uuidv4 from "uuid/v4";
import crypto from "crypto";
import fs from "fs";
import errorhandler from "errorhandler";

const API_STATUS_CODE = {
    MISSING_PARAMETERS: "MISSING_PARAMETERS",
    WRONG_PARAMETERS: "WRONG_PARAMETERS",
    ALREADY_REGISTERED: "ALREADY_REGISTERED",
    DATABASE_ERROR: "DATABASE_ERROR",
    SUCCESS: "SUCCESS"
};


// Configure JWT token options
const exp_jwt_delay = 30; // Number of minutes before the expiration of the JWT token
const privateKey = fs.readFileSync('keys/private_key');
const ExtractJwt = passportJWT.ExtractJwt;
const JwtStrategy = passportJWT.Strategy;
const jwtOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: fs.readFileSync('keys/public_key')
};
const options = {
    algorithm: 'RS256'
};

// JWT Custom Strategy
// Check if the token is in our database, if false, return Unauthorized. If true, call the next middleware
const strategy = new JwtStrategy(jwtOptions, function (jwt_payload, next) {
    db_session.query('SELECT * FROM jwt_tokens WHERE users_uuid = ?', [jwt_payload.uuid], function (error, results, fields) {
        if (error) {
            next(null, false);
        } else {
            const user = results[_.findIndex(results, {token: jwt.sign(jwt_payload, privateKey, options)})];
            if (user) {
                user.decoded_jwt = jwt_payload;
                next(null, user);
            } else {
                next(null, false);
            }
        }
    });
});
passport.use(strategy);

// Configure and launching Web Server
const app = express();
app.use(passport.initialize());
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.use(errorhandler({dumpExceptions: true, showStack: true}));

// CORS for cross-domain request
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header("Access-Control-Allow-Headers", "Origin, Authorization, X-Requested-With, Content-Type, Accept");
    next();
});

const router = express.Router();
app.use('/api/v1', router);

const server = app.listen(3000, function () {
    console.log("Web server is running on port 3000");
});

router.get("/get_devices", passport.authenticate('jwt', {session: false}), function (req, res) {
    db_session.query('SELECT * FROM devices WHERE users_uuid = ?', [req.user.users_uuid], function (error, results, fields) {
        if (error) {
            res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
        } else {
            let devices = results;
            db_session.query('SELECT * FROM devices_has_collections dhc JOIN collections c ON (dhc.id_collections = c.id_collections) WHERE c.users_uuid = ?', [req.user.users_uuid], function (error, results, fields) {
                if (error) {
                    res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                } else {
                    const groups = results;
                    devices.forEach(function (device) {
                        device.collections = [];
                        groups.forEach(function (group) {
                            if (device.id_devices === group.id_devices) {
                                let collection = {
                                    id_collections: group.id_collections,
                                    collections_name: group.collections_name
                                };
                                device.collections.push(collection);
                            }
                        });
                    });
                    res.json({code: API_STATUS_CODE.SUCCESS, message: "Successfully get info ", devices: devices});
                }
            });
        }
    });
});

router.post("/register_device", passport.authenticate('jwt', {session: false}), function (req, res) {
    if (req.body.devices_name) {
        db_session.query('INSERT INTO devices SET ?', {devices_name: req.body.devices_name, users_uuid: req.user.users_uuid}, function (error, results, fields) {
            if (error) {
                res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
            } else {
                res.json({code: API_STATUS_CODE.SUCCESS, message: "Success the device has been registered", deviceId: results.insertId});
            }
        });
    } else {
        res.status(400).json({code: API_STATUS_CODE.MISSING_PARAMETERS, message: "Device name is missing"});
    }
});

router.delete("/delete_device", passport.authenticate('jwt', {session: false}), function (req, res) {
    if (req.body.device_id) {
        if (req.body.keep_data) {
            if (req.body.keep_data === "false") {
                db_session.query('DELETE FROM devices WHERE id_devices = ? AND users_uuid = ?', [req.body.device_id, req.user.users_uuid], function (error, results, fields) {
                    if (error) {
                        res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                    } else {
                        if (results.affectedRows === 0) {
                            res.status(400).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "Wrong device_id"});
                        } else {
                            res.json({code: API_STATUS_CODE.SUCCESS, message: "Device deleted, Data deleted"});
                        }
                    }
                });
            } else if (req.body.keep_data === "true") {
                db_session.query('UPDATE devices SET is_deleted = ? WHERE id_devices = ? AND users_uuid = ?', [true, req.body.device_id, req.user.users_uuid], function (error, results, fields) {
                    if (error) {
                        res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                    } else {
                        if (results.affectedRows === 0) {
                            res.status(400).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "Wrong device_id"});
                        } else {
                            res.json({code: API_STATUS_CODE.SUCCESS, message: "Device deleted, Data kepy"});
                        }
                    }
                });
            } else {
                res.status(400).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "Keep_data is wrong"});
            }
        } else {
            res.status(400).json({code: API_STATUS_CODE.MISSING_PARAMETERS, message: "Keep_data is missing"});
        }
    } else {
        res.status(400).json({code: API_STATUS_CODE.MISSING_PARAMETERS, message: "Device_id is missing"});
    }
});

router.post("/create_group", passport.authenticate('jwt', {session: false}), function (req, res) {
    if (req.body.collections_name) {
        db_session.query('SELECT id_collections FROM collections WHERE users_uuid = ? AND collections_name = ?', [req.user.users_uuid, req.body.collections_name], function (error, results, fields) {
            if (error) {
                res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
            } else {
                const collectionId = results[0];
                if (!collectionId) {
                    db_session.query('INSERT INTO collections SET ?', {
                        collections_name: req.body.collections_name,
                        users_uuid: req.user.users_uuid
                    }, function (error, results, fields) {
                        if (error) {
                            res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                        } else {
                            res.json({code: API_STATUS_CODE.SUCCESS, message: "Success the group has been created", groupId: results.insertId});
                        }
                    });
                } else {
                    res.status(400).json({code: API_STATUS_CODE.ALREADY_REGISTERED, message: "This group already exist"});
                }
            }
        });
    } else {
        res.status(400).json({code: API_STATUS_CODE.MISSING_PARAMETERS, message: "Group name is missing"});
    }
});

router.delete("/delete_group", passport.authenticate('jwt', {session: false}), function (req, res) {
    if (req.body.collections_name) {
        db_session.query('DELETE FROM collections WHERE collections_name = ? AND users_uuid = ?', [req.body.collections_name, req.user.users_uuid], function (error, results, fields) {
            if (error) {
                res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
            } else {
                if (results.affectedRows === 0) {
                    res.status(400).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "Wrong group name"});
                } else {
                    res.json({code: API_STATUS_CODE.SUCCESS, message: "Group deleted"});
                }
            }
        });
    } else {
        res.status(400).json({code: API_STATUS_CODE.MISSING_PARAMETERS, message: "Group name is missing"});
    }
});

router.get("/list_group", passport.authenticate('jwt', {session: false}), function (req, res) {
    db_session.query('SELECT id_collections, collections_name FROM collections WHERE users_uuid = ?', [req.user.users_uuid], function (error, results, fields) {
        if (error) {
            res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
        } else {
            res.json({
                code: API_STATUS_CODE.SUCCESS,
                message: "Success",
                collections: results
            });
        }
    });
});

router.post("/add_device_to_group", passport.authenticate('jwt', {session: false}), function (req, res) {
    if (req.body.collections_name && req.body.device_id) {
        db_session.query('SELECT id_collections FROM collections WHERE users_uuid = ? AND collections_name = ?', [req.user.users_uuid, req.body.collections_name], function (error, results, fields) {
            if (error) {
                res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
            } else {
                const collectionId = results[0];
                if (!collectionId) {
                    res.status(400).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "This group doesn't exist"});
                } else {
                    db_session.query('SELECT id_devices FROM devices WHERE users_uuid = ? AND id_devices = ?', [req.user.users_uuid, req.body.device_id], function (error, results, fields) {
                        if (error) {
                            res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                        } else {
                            const deviceId = results[0];
                            if (!deviceId) {
                                res.status(400).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "This device doesn't exist"});
                            } else {
                                db_session.query('SELECT * FROM devices_has_collections WHERE id_devices = ? AND id_collections = ?', [deviceId.id_devices, collectionId.id_collections], function (error, results, fields) {
                                    if (error) {
                                        res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                                    } else {
                                        const alreadyRegistered = results[0];
                                        if (!alreadyRegistered) {
                                            db_session.query('INSERT INTO devices_has_collections SET ?', {
                                                id_devices: deviceId.id_devices,
                                                id_collections: collectionId.id_collections
                                            }, function (error, results, fields) {
                                                if (error) {
                                                    res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                                                } else {
                                                    res.json({
                                                        code: API_STATUS_CODE.SUCCESS,
                                                        message: "Success the device has been added to group",
                                                        deviceId: parseInt(deviceId.id_devices),
                                                        collectionId: collectionId.id_collections
                                                    });
                                                }
                                            });
                                        } else {
                                            res.status(400).json({code: API_STATUS_CODE.ALREADY_REGISTERED, message: "The device is already registered in this group"});
                                        }
                                    }
                                });
                            }
                        }
                    });
                }
            }
        });
    } else {
        res.status(400).json({code: API_STATUS_CODE.MISSING_PARAMETERS, message: "Group name or device_id is missing"});
    }
});

router.delete("/remove_device_from_group", passport.authenticate('jwt', {session: false}), function (req, res) {
    if (req.body.collections_name && req.body.device_id) {
        db_session.query('SELECT id_collections FROM collections WHERE users_uuid = ? AND collections_name = ?', [req.user.users_uuid, req.body.collections_name], function (error, results, fields) {
            if (error) {
                res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
            } else {
                const collectionId = results[0];
                if (!collectionId) {
                    res.status(400).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "This group doesn't exist"});
                } else {
                    db_session.query('SELECT id_devices FROM devices WHERE users_uuid = ? AND id_devices = ?', [req.user.users_uuid, req.body.device_id], function (error, results, fields) {
                        if (error) {
                            res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                        } else {
                            const deviceId = results[0];
                            if (!deviceId) {
                                res.status(400).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "This device doesn't exist"});
                            } else {
                                db_session.query('SELECT * FROM devices_has_collections WHERE id_devices = ? AND id_collections = ?', [req.body.device_id, collectionId.id_collections], function (error, results, fields) {
                                    if (error) {
                                        res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                                    } else {
                                        const inGroup = results[0];
                                        if (!inGroup) {
                                            res.status(400).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "The device is not registered in this group"});
                                        } else {
                                            db_session.query('DELETE FROM devices_has_collections WHERE id_devices = ? AND id_collections = ?', [inGroup.id_devices, inGroup.id_collections], function (error, results, fields) {
                                                if (error) {
                                                    res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                                                } else {
                                                    res.json({code: API_STATUS_CODE.SUCCESS, message: "Device deleted from group"});
                                                }
                                            });
                                        }
                                    }
                                });
                            }
                        }
                    });
                }
            }
        });
    } else {
        res.status(400).json({code: API_STATUS_CODE.MISSING_PARAMETERS, message: "Group name or device_id is missing"});
    }
});

router.post('/register', (req, res) => {
    if (req.body.first_name && req.body.last_name && req.body.email && req.body.password) {
        const password_hash = crypto.createHash('sha256').update(req.body.password).digest('hex');
        const user_info = {
            uuid: uuidv4(),
            first_name: req.body.first_name,
            last_name: req.body.last_name,
            email: req.body.email,
            password: password_hash
        };
        db_session.query('SELECT * FROM users WHERE email = ?', [req.body.email], function (error, results, fields) {
            if (error) {
                res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
            } else {
                if (results.length !== 0) {
                    res.status(403).json({code: API_STATUS_CODE.ALREADY_REGISTERED, message: "User is already registered"});
                } else {
                    db_session.query('INSERT INTO users SET ?', user_info, function (error, results, fields) {
                        if (error) {
                            res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                        } else {
                            res.json({code: API_STATUS_CODE.SUCCESS, message: "User successfully created"});

                        }
                    });
                }
            }
        });
    } else {
        res.status(400).json({message: "Something is missing, please verify your POST parameters"});
    }
});

router.post("/login", function (req, res) {
    if (req.body.email && req.body.password) {
        db_session.query('SELECT * FROM users WHERE email = ?', req.body.email, function (error, results, fields) {
            if (error) {
                res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
            } else {
                const user = results[0];
                const password_hash = crypto.createHash('sha256').update(req.body.password).digest('hex');
                if (!user) {
                    res.status(401).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "User not found"});
                } else if (user.password === password_hash) {
                    if (req.body.device_id) {
                        db_session.query('SELECT id_devices FROM devices WHERE users_uuid = ? AND id_devices = ?', [user.uuid, req.body.device_id], function (error, results, fields) {
                            if (error) {
                                res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                            } else {
                                const deviceId = results[0];
                                if (!deviceId) {
                                    res.status(400).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "This device doesn't exist"});
                                    return;
                                } else {
                                    let groupsInfo = [];
                                    db_session.query('SELECT * FROM devices_has_collections dhc JOIN collections c ON (dhc.id_collections = c.id_collections) WHERE c.users_uuid = ? AND dhc.id_devices = ?', [user.uuid, deviceId.id_devices], function (error, results, fields) {
                                        if (error) {
                                            res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                                        } else {
                                            results.forEach(function (group) {
                                                let collection = {
                                                    id_collections: group.id_collections,
                                                    collections_name: group.collections_name
                                                };
                                                groupsInfo.push(collection);
                                            });
                                            const payload = {
                                                uuid: user.uuid,
                                                device_id: deviceId.id_devices,
                                                groups: groupsInfo,
                                                exp: (Math.floor(new Date() / 1000) + (exp_jwt_delay * 60))
                                            };
                                            const token = jwt.sign(payload, privateKey, options);
                                            db_session.query('INSERT INTO jwt_tokens SET ?', {users_uuid: user.uuid, token: token}, function (error, results, fields) {
                                                if (error) {
                                                    res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                                                } else {
                                                    res.json({code: API_STATUS_CODE.SUCCESS, message: "Success", token: token});
                                                }
                                            });
                                        }
                                    });
                                }
                            }
                        });
                    } else {
                        const payload = {
                            uuid: user.uuid,
                            exp: (Math.floor(new Date() / 1000) + (exp_jwt_delay * 60))
                        };
                        const token = jwt.sign(payload, privateKey, options);
                        db_session.query('INSERT INTO jwt_tokens SET ?', {users_uuid: user.uuid, token: token}, function (error, results, fields) {
                            if (error) {
                                res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                            } else {
                                res.json({code: API_STATUS_CODE.SUCCESS, message: "Success", token: token});
                            }
                        });
                    }
                } else {
                    res.status(401).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "Wrong password"});
                }
            }
        });
    } else {
        res.status(400).json({code: API_STATUS_CODE.MISSING_PARAMETERS, message: "Email or Password is missing"});
    }
});

router.post("/renew_jwt", function (req, res) {
    if (req.body.token) {
        let old_token = JSON.parse(new Buffer(req.body.token.split('.')[1], 'base64'));
        let payload = {};
        if (old_token.device_id) {
            payload = {
                uuid: old_token.uuid,
                device_id: old_token.device_id,
                exp: (Math.floor(new Date() / 1000) + (exp_jwt_delay * 60))
            };
        } else {
            payload = {
                uuid: old_token.uuid,
                exp: (Math.floor(new Date() / 1000) + (exp_jwt_delay * 60))
            };
        }
        const token = jwt.sign(payload, privateKey, options);
        db_session.query('UPDATE jwt_tokens SET token = ? WHERE token = ?', [token, req.body.token], function (error, results, fields) {
            if (error) {
                res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
            } else if (results) {
                if (results.affectedRows !== undefined && results.affectedRows !== 0) {
                    res.json({code: API_STATUS_CODE.SUCCESS, message: "Success", token: token});
                } else {
                    res.status(401).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "Invalid token"});
                }
            }
        });
    } else {
        res.status(400).json({code: API_STATUS_CODE.MISSING_PARAMETERS, message: "Old token is missing"});
    }
});

router.delete("/delete_jwt", passport.authenticate('jwt', {session: false}), function (req, res) {
    db_session.query('DELETE FROM jwt_tokens WHERE token = ?', [req.user.token], function (error, results, fields) {
        if (error) {
            res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
        } else {
            res.json({code: API_STATUS_CODE.SUCCESS, message: "Success the token have been deleted"});
        }
    });
});

router.delete("/delete_all_jwt", passport.authenticate('jwt', {session: false}), function (req, res) {
    db_session.query('DELETE FROM jwt_tokens WHERE users_uuid = ?', [req.user.users_uuid], function (error, results, fields) {
        if (error) {
            res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
        } else {
            res.json({code: API_STATUS_CODE.SUCCESS, message: "Success all the token have been deleted"});
        }
    });
});

router.delete("/delete_user", passport.authenticate('jwt', {session: false}), function (req, res) {
    db_session.query('SELECT * FROM users WHERE uuid = ?', [req.user.users_uuid], function (error, results, fields) {
        if (error) {
            res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
        } else if (results && req.body.password) {
            const password_hash = crypto.createHash('sha256').update(req.body.password ? req.body.password : "").digest('hex');
            if (password_hash === results[0].password) {
                db_session.query('DELETE FROM users WHERE uuid = ?', [req.user.users_uuid], function (error, results, fields) {
                    if (error) {
                        res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                    } else {
                        res.json({code: API_STATUS_CODE.SUCCESS, message: "Success user and his data have been deleted"});
                    }
                });
            } else {
                res.status(401).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "Wrong password"});
            }
        } else {
            res.status(401).json({code: API_STATUS_CODE.MISSING_PARAMETERS, message: "Missing password"});
        }
    });
});

router.put("/update_user", passport.authenticate('jwt', {session: false}), function (req, res) {
    db_session.query('SELECT * FROM users WHERE uuid = ?', [req.user.users_uuid], function (error, results, fields) {
        if (error) {
            res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
        } else if (results) {
            const password_hash = crypto.createHash('sha256').update(req.body.password ? req.body.password : "").digest('hex');
            if (password_hash === results[0].password) {
                const password_hash = req.body.new_password !== undefined ? crypto.createHash('sha256').update(req.body.new_password).digest('hex') : results[0].password;
                const nUser = {
                    uuid: req.user.users_uuid,
                    first_name: req.body.first_name !== undefined ? req.body.first_name : results[0].first_name,
                    last_name: req.body.last_name !== undefined ? req.body.last_name : results[0].last_name,
                    email: req.body.email !== undefined ? req.body.email : results[0].email,
                    password: password_hash
                };
                const update = [nUser.first_name, nUser.last_name, nUser.email, nUser.password, nUser.uuid];
                db_session.query('UPDATE users SET first_name = ?, last_name = ?, email = ?, password = ? WHERE uuid = ?', update, function (error, results, fields) {
                    if (error) {
                        if (error.code === 'ER_DUP_ENTRY') {
                            res.status(403).json({code: API_STATUS_CODE.ALREADY_REGISTERED, error: "Email already used"});
                        } else {
                            res.status(500).json({code: API_STATUS_CODE.DATABASE_ERROR, message: "Query to database error"});
                        }
                    } else {
                        res.json({code: API_STATUS_CODE.SUCCESS, message: "User updated"});
                    }
                });
            } else {
                res.status(401).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "Wrong password"});
            }
        } else {
            res.status(401).json({code: API_STATUS_CODE.WRONG_PARAMETERS, message: "User doesn't exist"});
        }
    });
});

// This function is called when the server received a SIGTERM or SIGINT to die gracefully
const gracefulShutdown = function () {
    db_session.end();
    server.close(function () {
        console.log("Shutting down database connection and web server.");
        process.exit()
    });

    setTimeout(function () {
        console.error("Could not close connections in time, forcefully shutting down");
        process.exit()
    }, 10000);
};

process.on('uncaughtException', function (exception) {
    console.log(exception);
});

// Catch SIGTERM and SIGINT signal and call gracefulShutdown function
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
