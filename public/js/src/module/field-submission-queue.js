'use strict';

var settings = require( './settings' );
var t = require( './translator' ).t;
var utils = require( './utils' );
var $ = require( 'jquery' );
var gui = require( './gui' );
var FIELDSUBMISSION_URL = ( settings.enketoId ) ? settings.basePath + '/fieldsubmission/' + settings.enketoIdPrefix + settings.enketoId +
    utils.getQueryString( settings.submissionParameter ) : null;

function FieldSubmissionQueue() {
    this.submissionQueue = {};
    this.submissionOngoing = false;
    this.repeatRemovalCounter = 0;
}

FieldSubmissionQueue.prototype.get = function() {
    return this.submissionQueue;
};


FieldSubmissionQueue.prototype.addFieldSubmission = function( fieldPath, xmlFragment, instanceId, deprecatedId, file ) {
    var fd = new FormData();

    if ( fieldPath && xmlFragment && instanceId ) {

        fd.append( 'instanceID', instanceId );
        fd.append( 'xml_submission_fragment_file', new Blob( [ xmlFragment ], {
            type: 'text/xml'
        } ), 'xml_submission_fragment_file.xml' );

        if ( file && file instanceof Blob ) {
            fd.append( file.name, file, file.name );
        }

        if ( deprecatedId ) {
            fd.append( 'deprecatedID', deprecatedId );
            // Overwrite if older value fieldsubmission in queue.
            this.submissionQueue[ 'PUT_' + fieldPath ] = fd;
        } else {
            this.submissionQueue[ 'POST_' + fieldPath ] = fd;
        }

        console.debug( 'new fieldSubmissionQueue', this.submissionQueue );
    } else {
        console.error( 'Attempt to add field submission without path, XML fragment or instanceID' );
    }
};

FieldSubmissionQueue.prototype.addRepeatRemoval = function( xmlFragment, instanceId, deprecatedId ) {
    var fd = new FormData();
    if ( xmlFragment && instanceId ) {

        // TODO: fragment as Blob
        fd.append( 'xml_submission_fragment_file', new Blob( [ xmlFragment ], {
            type: 'text/xml'
        } ), 'xml_submission_fragment_file.xml' );

        fd.append( 'instanceID', instanceId );
        if ( deprecatedId ) {
            fd.append( 'deprecatedID', deprecatedId );
        }
        // Overwrite if older value fieldsubmission in queue.
        this.submissionQueue[ 'DELETE_' + this.repeatRemovalCounter++ ] = fd;
        console.debug( 'new fieldSubmissionQueue', this.submissionQueue );
    } else {
        console.error( 'Attempt to add repeat removal without XML fragment or instanceID' );
    }
};

FieldSubmissionQueue.prototype.submitAll = function() {
    var submission;
    var _queue;
    var method;
    var that = this;
    var authRequired;

    if ( Object.keys( this.submissionQueue ).length > 0 && !this.submissionOngoing ) {
        this.submissionOngoing = true;
        this._uploadStatus.update( 'ongoing' );

        // convert fieldSubmission object to array of objects
        _queue = Object.keys( that.submissionQueue ).map( function( key ) {
            return {
                key: key,
                fd: that.submissionQueue[ key ]
            };
        } );
        console.debug( 'queue to submit', _queue );
        // empty the fieldSubmission queue
        that.submissionQueue = {};
        return _queue.reduce( function( prevPromise, fieldSubmission ) {
                return prevPromise.then( function() {
                    method = fieldSubmission.key.split( '_' )[ 0 ];
                    return that._submitOne( fieldSubmission.fd, method )
                        .catch( function( error ) {
                            console.debug( 'failed to submit ', fieldSubmission.key, 'adding it back to the queue, ERROR:', error );
                            // add back to the fieldSubmission queue if the field value wasn't overwritten in the mean time
                            if ( typeof that.submissionQueue[ fieldSubmission.key ] === 'undefined' ) {
                                that.submissionQueue[ fieldSubmission.key ] = fieldSubmission.fd;
                            }
                            if ( error.status === 401 ) {
                                authRequired = true;
                            }
                            return error;
                        } );
                } );
            }, Promise.resolve() )
            .then( function( lastResult ) {
                console.debug( 'all done with queue submission current queue is', that.submissionQueue );
                if ( authRequired ) {
                    gui.confirmLogin();
                }
            } )
            .catch( function( error ) {
                console.error( 'Unexpected error:', error.message );
            } )
            .then( function() {
                that._resetSubmissionInterval();
                that.submissionOngoing = false;
                that._uploadStatus.update( Object.keys( that.submissionQueue ).length > 0 ? 'error' : 'success' );
                return true;
            } );
    }
};

FieldSubmissionQueue.prototype._submitOne = function( fd, method ) {
    var error;

    return new Promise( function( resolve, reject ) {
        $.ajax( FIELDSUBMISSION_URL, {
                type: method,
                data: fd,
                cache: false,
                contentType: false,
                processData: false,
                headers: {
                    'X-OpenClinica-Version': '1.0'
                },
                timeout: 3 * 60 * 1000
            } )
            .done( function( data, textStatus, jqXHR ) {
                if ( jqXHR.status === 201 || jqXHR.status === 202 ) {
                    resolve( jqXHR.status );
                } else {
                    throw jqXHR;
                }
            } )
            .fail( function( jqXHR ) {
                error = new Error( jqXHR.statusText );
                error.status = jqXHR.status;
                reject( error );
            } );
    } );
};

FieldSubmissionQueue.prototype._resetSubmissionInterval = function() {
    var that = this;
    clearInterval( this.submissionInterval );
    this.submissionInterval = setInterval( function() {
        that.submitAll();
    }, 1 * 60 * 1000 );
};

/**
 * Shows upload progress
 *
 * @type {Object}
 */
FieldSubmissionQueue.prototype._uploadStatus = {
    _getBox: function() {
        if ( !this._$box ) {
            this._$box = $( '<div class="fieldsubmission-status"/>' ).prependTo( 'body' );
        }
        return this._$box;
    },
    _getText: function( status ) {
        // TODO translate strings
        return {
            ongoing: 'Saving...',
            success: 'All valid changes saved.',
            error: 'Failed to save changes'
        }[ status ];
    },
    _updateClass: function( status ) {
        this._getBox().removeClass( 'ongoing success error' ).addClass( status ).text( this._getText( status ) );
    },
    update: function( status ) {
        this._updateClass( status );
    }
};

module.exports = FieldSubmissionQueue;